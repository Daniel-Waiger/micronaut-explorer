import json
import os
import argparse
from google import genai
from pydantic import BaseModel

class LearnOutcome(BaseModel):
    new_lessons: list[str]
    deleted_lessons: list[str]
    merged_lessons: list[str]
    updated_content: str

LEARN_PROMPT = """You are the LEARNING stage of a plan-gated build pipeline. 
Your job is to read the results of a recent execution run, plus any orchestrator/user notes, 
and update the target repo's docs/cma-lessons.md (which we will now call ama-lessons.md or keep as cma-lessons.md) 
with new invariants, practices, or removed stale lessons.

TARGET REPOSITORY (absolute path): {repo_path}
CURRENT LESSONS CONTENT:
{current_lessons}

RUN REPORT:
{run_report}

Rules:
1. Extract any new failure modes, invariant violations, or successful verification strategies from the run report.
2. Formulate them into concise lessons (practice — evidence — why it matters).
3. If any existing lessons are redundant or have stopped earning their space, remove them.
4. Merge related lessons if possible to keep the file short.
5. IMPORTANT: When you add a new lesson or modify an existing one, you MUST append the signature `[ama-run]` at the end of the lesson text. This allows the user to track which lessons were added by AMA vs Claude.
6. Return the full updated markdown content for the lessons file in `updated_content`.
"""

def learn(client, repo_path, run_report, current_lessons):
    prompt = LEARN_PROMPT.format(
        repo_path=repo_path,
        current_lessons=current_lessons,
        run_report=run_report
    )
    
    print("Generating updated lessons using gemini-3.1-pro-preview...")
    response = client.models.generate_content(
        model='gemini-3.1-pro-preview',
        contents=prompt,
        config=genai.types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=LearnOutcome,
            temperature=0.2,
        ),
    )
    
    return LearnOutcome.model_validate_json(response.text)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=str, required=True, help="Path to the execution report or journal")
    parser.add_argument("--repo-path", type=str, default=os.getcwd())
    args = parser.parse_args()
    
    lessons_path = os.path.join(args.repo_path, "docs", "cma-lessons.md")
    current_lessons = ""
    if os.path.exists(lessons_path):
        with open(lessons_path, 'r', encoding='utf-8') as f:
            current_lessons = f.read()
            
    with open(args.report, 'r', encoding='utf-8') as f:
        run_report = f.read()
        
    client = genai.Client()
    
    outcome = learn(client, args.repo_path, run_report, current_lessons)
    
    print(f"Added {len(outcome.new_lessons)} lessons, deleted {len(outcome.deleted_lessons)}, merged {len(outcome.merged_lessons)}")
    
    with open(lessons_path, 'w', encoding='utf-8') as f:
        f.write(outcome.updated_content)
    
    print(f"Updated {lessons_path}")
