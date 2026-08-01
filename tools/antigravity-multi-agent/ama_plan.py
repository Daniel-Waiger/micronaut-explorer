import json
import os
import argparse
from google import genai
from pydantic import BaseModel
from typing import List, Optional

class Risk(BaseModel):
    risk: str
    mitigation: str

class Task(BaseModel):
    id: str
    title: str
    scope: str
    depends_on: List[str]
    parallel_safe: bool
    verification: str

class TaskGraph(BaseModel):
    objective: str
    assumptions: List[str]
    tasks: List[Task]
    batches: List[List[str]]
    risks: List[Risk]

PLANNER_PROMPT = """You are the PLANNING stage of a plan-gated, multi-model build pipeline. You do NOT write code or run commands — you produce a task graph that a separate executor model will implement and a verifier model will check.

TARGET REPOSITORY (absolute path): {repo_path}
When you name files in a task's "scope", use paths under this repository.

BEFORE ANYTHING ELSE: read {repo_path}/docs/cma-lessons.md if it exists — it is
the pipeline's accumulated experience. Apply it: bake the relevant
invariants into each task's scope, size tasks per its guidance, and design
verification steps in the styles it says worked.

OBJECTIVE:
{objective}

CONSTRAINTS:
{constraints}

Rules:
- Each task must be small enough to complete in one focused implementation step (about one file or one cohesive change).
- Every task needs concrete, checkable verification (a command to run or a specific file/content to confirm) — never "looks good".
- Declare depends_on accurately. Mark parallel_safe true only when a task touches files disjoint from every other task in its batch.
- Prefer reusing existing files/utilities over inventing new ones.
- Order 'batches' by dependency: everything in batch N may assume batches 0..N-1 are done.
"""

def generate_plan(objective: str, repo_path: str, constraints: str) -> TaskGraph:
    client = genai.Client()
    prompt = PLANNER_PROMPT.format(
        repo_path=repo_path,
        objective=objective,
        constraints=constraints
    )
    
    print("Generating plan using gemini-3.1-pro-preview...")
    response = client.models.generate_content(
        model='gemini-3.1-pro-preview',
        contents=prompt,
        config=genai.types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=TaskGraph,
            temperature=0.2,
        ),
    )
    
    return TaskGraph.model_validate_json(response.text)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Antigravity Multi-Agent: Planner")
    parser.add_argument("--objective", type=str, required=True, help="The goal to decompose into tasks")
    parser.add_argument("--repo-path", type=str, default=os.getcwd(), help="Absolute path of the target repo")
    parser.add_argument("--constraints", type=str, default="None beyond keeping tasks small and verifiable.", help="Extra constraints")
    parser.add_argument("--output", type=str, default="docs/plans/ama-task-graph.json", help="Where to save the plan")
    
    args = parser.parse_args()
    
    try:
        plan = generate_plan(args.objective, args.repo_path, args.constraints)
        
        out_path = os.path.join(args.repo_path, args.output)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(plan.model_dump_json(indent=2))
        
        print(f"Plan ready: {len(plan.tasks)} task(s) across {len(plan.batches)} batch(es).")
        print(f"Saved to {out_path}")
    except Exception as e:
        print(f"Error generating plan: {e}")
