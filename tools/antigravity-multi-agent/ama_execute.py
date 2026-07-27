import json
import os
import subprocess
import argparse
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import List, Optional

class Change(BaseModel):
    file: str
    summary: str

class ExecOutcome(BaseModel):
    task_id: str
    changes: List[Change]
    commands_run: List[str]
    verification: str
    outcome: str # 'done' or 'blocked'
    next_step: str

class VerifyOutcome(BaseModel):
    task_id: str
    pass_: bool # using pass_ because pass is a keyword
    evidence: str
    problems: List[str]
    recommendation: str

# Define tools for the executor agent
def read_file(filepath: str) -> str:
    """Reads the contents of a file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {e}"

def write_file(filepath: str, content: str) -> str:
    """Writes content to a file, overwriting it."""
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return "Success"
    except Exception as e:
        return f"Error writing file: {e}"

def run_command(command: str) -> str:
    """Runs a shell command and returns its output."""
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60)
        out = result.stdout
        if result.stderr:
            out += "\nSTDERR:\n" + result.stderr
        return out if out else "Success (no output)"
    except Exception as e:
        return f"Error running command: {e}"

EXEC_PROMPT = """You are the EXECUTION stage of a plan-gated build pipeline. Complete EXACTLY ONE task.

TARGET REPOSITORY (absolute path): {repo_path}
IMPORTANT: All file operations MUST be inside this repository. Use absolute paths under it.

BEFORE ANYTHING ELSE: read {repo_path}/docs/cma-lessons.md if it exists. Apply its lessons.

TASK {task_id}: {task_title}
Scope: {task_scope}
Verification criteria: {task_verification}
{prior_feedback}

Rules:
1. Use your tools to read the necessary files.
2. Edit the files required to complete the task.
3. Run any commands (like tests) to ensure your changes work.
4. When finished, you MUST return a final structured JSON matching the ExecOutcome schema. You can do this by using the submit_outcome tool or simply outputting the final JSON (if your client supports it).
"""

VERIFY_PROMPT = """You are the VERIFICATION stage of a plan-gated build pipeline. An executor just implemented a task. ADVERSARIALLY verify it — assume it may be wrong and try to prove it is NOT done. Do NOT fix anything; you judge.

TARGET REPOSITORY (absolute path): {repo_path}
BEFORE ANYTHING ELSE: read {repo_path}/docs/cma-lessons.md if it exists.

TASK {task_id}: {task_title}
Scope: {task_scope}
Verification criteria the change must meet: {task_verification}

The executor reported:
{exec_report}

Do NOT trust that report. Use your tools to independently inspect the actual files under {repo_path} and run the relevant check yourself. 
Set pass=false if the criteria are not genuinely met, if files are missing/wrong, or if you are uncertain.
"""

def execute_task(client, task, repo_path, prior_feedback=""):
    print(f"\n--- EXECUTING TASK {task['id']} ---")
    prompt = EXEC_PROMPT.format(
        repo_path=repo_path,
        task_id=task['id'],
        task_title=task['title'],
        task_scope=task['scope'],
        task_verification=task['verification'],
        prior_feedback=f"\nA previous attempt FAILED verification. Fix exactly these problems:\n{prior_feedback}\n" if prior_feedback else ""
    )
    
    # In a full implementation, we'd loop with tool calls until the model decides it's done,
    # then ask it to output the ExecOutcome schema.
    # For this prototype, we'll use a chat session.
    chat = client.chats.create(
        model='gemini-3.6-flash',
        config=types.GenerateContentConfig(
            temperature=0.2,
            tools=[read_file, write_file, run_command]
        )
    )
    
    # We tell it to do its work, then we ask for the final schema.
    chat.send_message(prompt + "\nDo your work using tools, then reply 'DONE' when you are ready to submit your report.")
    
    # Now ask for the structured outcome
    outcome_response = client.models.generate_content(
        model='gemini-3.6-flash',
        contents="You have completed your work. Now generate the final report.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ExecOutcome,
            temperature=0.0
        )
    )
    
    return ExecOutcome.model_validate_json(outcome_response.text)

def verify_task(client, task, repo_path, exec_outcome):
    print(f"\n--- VERIFYING TASK {task['id']} ---")
    exec_report = exec_outcome.model_dump_json(indent=2)
    prompt = VERIFY_PROMPT.format(
        repo_path=repo_path,
        task_id=task['id'],
        task_title=task['title'],
        task_scope=task['scope'],
        task_verification=task['verification'],
        exec_report=exec_report
    )
    
    chat = client.chats.create(
        model='gemini-3.1-pro-preview',
        config=types.GenerateContentConfig(
            temperature=0.0,
            tools=[read_file, run_command]
        )
    )
    
    chat.send_message(prompt + "\nVerify the work using tools, then reply 'DONE'.")
    
    outcome_response = client.models.generate_content(
        model='gemini-3.1-pro-preview',
        contents="You have completed your verification. Now generate the final verdict.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=VerifyOutcome,
            temperature=0.0
        )
    )
    
    return VerifyOutcome.model_validate_json(outcome_response.text)

def update_dash(args_list: List[str]):
    try:
        update_script = os.path.join(os.getcwd(), 'tools', 'cma-dashboard', 'update.py')
        subprocess.run(['python', update_script] + args_list, check=False)
    except Exception as e:
        print(f"Dashboard update failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=str, required=True, help="Path to the task graph JSON")
    parser.add_argument("--repo-path", type=str, default=os.getcwd())
    args = parser.parse_args()
    
    with open(args.plan, 'r') as f:
        plan = json.load(f)
        
    client = genai.Client()
    
    tasks_by_id = {t['id']: t for t in plan['tasks']}
    batches = plan.get('batches', [[t['id'] for t in plan['tasks']]])
    
    results = []
    
    # Initialize dashboard
    update_dash([
        "--run", "AMA Execution Run",
        "--orch", "Antigravity Multi-Agent",
        "--model", "Gemini",
        "--status", "running",
        "--log", "AMA Run Started"
    ])
    
    for i, batch in enumerate(batches):
        phase = f"Batch {i+1}"
        for task_id in batch:
            task = tasks_by_id.get(task_id)
            if not task: continue
            
            update_dash([
                "--status", "running",
                "--phase", phase,
                "--current", task_id, task['title'],
                "--task-add", f"{task_id}={phase}={task['title']}=running:Gemini Flash",
                "--log", f"Dispatched {task_id}"
            ])
            
            # Execute
            exec_outcome = execute_task(client, task, args.repo_path)
            
            update_dash(["--task", f"{task_id}=verifying:Gemini Pro", "--log", f"Verifying {task_id}"])
            
            # Verify
            verify_outcome = verify_task(client, task, args.repo_path, exec_outcome)
            
            # Retry logic
            if not verify_outcome.pass_:
                update_dash([
                    "--task", f"{task_id}=running:Gemini Flash",
                    "--log", f"{task_id} verifier FAIL, retrying..."
                ])
                print(f"Task {task_id} failed verification. Retrying...")
                feedback = "\\n".join(verify_outcome.problems)
                exec_outcome = execute_task(client, task, args.repo_path, feedback)
                
                update_dash(["--task", f"{task_id}=verifying:Gemini Pro", "--log", f"Re-verifying {task_id}"])
                verify_outcome = verify_task(client, task, args.repo_path, exec_outcome)
                
            if verify_outcome.pass_:
                update_dash([
                    "--task", f"{task_id}=done:Gemini Pro (Verified)",
                    "--log", f"{task_id} verified PASS"
                ])
                print(f"Task {task_id} VERIFIED successfully.")
                results.append({"id": task_id, "status": "VERIFIED"})
            else:
                update_dash([
                    "--task", f"{task_id}=failed:Gemini Pro",
                    "--status", "failed",
                    "--log", f"{task_id} FAILED after retry. Halting."
                ])
                print(f"Task {task_id} FAILED verification after retry. Stopping.")
                exit(1)
    
    update_dash(["--status", "done", "--current-clear", "--log", "All tasks completed successfully."])
