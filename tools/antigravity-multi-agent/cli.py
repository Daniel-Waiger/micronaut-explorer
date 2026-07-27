import argparse
import sys
import os
from dotenv import load_dotenv

load_dotenv()

def cmd_plan(args):
    # We can just invoke the script or import its main method
    from ama_plan import generate_plan
    try:
        plan = generate_plan(args.objective, args.repo_path, args.constraints)
        out_path = os.path.join(args.repo_path, args.output)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(plan.model_dump_json(indent=2))
        print(f"Plan ready: {len(plan.tasks)} task(s) across {len(plan.batches)} batch(es). Saved to {out_path}")
    except Exception as e:
        print(f"Plan error: {e}")

def cmd_execute(args):
    import json
    from google import genai
    from ama_execute import execute_task, verify_task
    
    with open(args.plan, 'r') as f:
        plan = json.load(f)
    
    client = genai.Client()
    tasks_by_id = {t['id']: t for t in plan['tasks']}
    batches = plan.get('batches', [[t['id'] for t in plan['tasks']]])
    
    results = []
    
    for batch in batches:
        for task_id in batch:
            task = tasks_by_id.get(task_id)
            if not task: continue
            
            exec_outcome = execute_task(client, task, args.repo_path)
            verify_outcome = verify_task(client, task, args.repo_path, exec_outcome)
            
            if not verify_outcome.pass_:
                print(f"Task {task_id} failed verification. Retrying...")
                feedback = "\\n".join(verify_outcome.problems)
                exec_outcome = execute_task(client, task, args.repo_path, feedback)
                verify_outcome = verify_task(client, task, args.repo_path, exec_outcome)
                
            if verify_outcome.pass_:
                print(f"Task {task_id} VERIFIED successfully.")
                results.append({"id": task_id, "status": "VERIFIED"})
            else:
                print(f"Task {task_id} FAILED verification after retry. Stopping.")
                sys.exit(1)

def cmd_learn(args):
    from google import genai
    from ama_learn import learn
    
    lessons_path = os.path.join(args.repo_path, "docs", "cma-lessons.md")
    current_lessons = ""
    if os.path.exists(lessons_path):
        with open(lessons_path, 'r', encoding='utf-8') as f:
            current_lessons = f.read()
            
    with open(args.report, 'r', encoding='utf-8') as f:
        run_report = f.read()
        
    client = genai.Client()
    outcome = learn(client, args.repo_path, run_report, current_lessons)
    
    print(f"Added {len(outcome.new_lessons)} lessons, deleted {len(outcome.deleted_lessons)}")
    with open(lessons_path, 'w', encoding='utf-8') as f:
        f.write(outcome.updated_content)
    print(f"Updated {lessons_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="ama", description="Antigravity Multi-Agent")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    # PLAN
    parser_plan = subparsers.add_parser("plan", help="Generate a task graph plan")
    parser_plan.add_argument("--objective", type=str, required=True, help="The goal to decompose into tasks")
    parser_plan.add_argument("--repo-path", type=str, default=os.getcwd(), help="Absolute path of the target repo")
    parser_plan.add_argument("--constraints", type=str, default="None beyond keeping tasks small and verifiable.", help="Extra constraints")
    parser_plan.add_argument("--output", type=str, default="docs/plans/ama-task-graph.json", help="Where to save the plan")
    parser_plan.set_defaults(func=cmd_plan)
    
    # EXECUTE
    parser_exec = subparsers.add_parser("execute", help="Execute an approved task graph")
    parser_exec.add_argument("--plan", type=str, required=True, help="Path to the task graph JSON")
    parser_exec.add_argument("--repo-path", type=str, default=os.getcwd())
    parser_exec.set_defaults(func=cmd_execute)
    
    # LEARN
    parser_learn = subparsers.add_parser("learn", help="Distill lessons from a run")
    parser_learn.add_argument("--report", type=str, required=True, help="Path to the execution report or journal")
    parser_learn.add_argument("--repo-path", type=str, default=os.getcwd())
    parser_learn.set_defaults(func=cmd_learn)
    
    args = parser.parse_args()
    args.func(args)
