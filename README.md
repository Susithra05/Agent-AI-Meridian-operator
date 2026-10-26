Meridian Operator

A small accounts clerk. You give it a goal, such as "post the latest Helios invoice", and it has to finish the work. It cannot see the screen. Each turn it picks one tool, reads the text that tool returns, and then decides the next turn.

When it says the job is done, a second check opens the ledger. That check does not trust the model's summary. The bill has to actually be there, for the right amount.

Run

Node 22 or newer. I used Node 24.

npm install

Copy .env.example to .env and paste a key into OPERATOR_API_KEY. On Windows:

copy .env.example .env

I did not have Grok API credits, so I used a free Gemini key. My .env is:

OPERATOR_API_KEY=
OPERATOR_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
OPERATOR_MODEL=gemini-3.8-flash

If those last two lines are left out, the server calls xAI with grok-4.5 instead.

npm run dev

Open http://localhost:8080. Do not commit .env.

npm test needs no key. npm run typecheck checks the types. npm run build then npm start runs the built app.

What a run does

The model has to answer with JSON: a phase, a short reason, and at most one tool. The app runs that tool on a fake company and sends the result back. It stops when one of these happens:

the model says it is finished, and the checker agrees (it gets one retry if the checker says no)

it asks for approval and waits until you click Approve or Reject

it asks you a question

it has made 10 model calls, you press Stop, or the API errors

On the Helios job the portal is set to fail the first call. The newest Helios document is a draft, so it must be ignored. The real open bill is ₹3,12,400, which is over ₹2,50,000, so nothing can be posted until you approve it.

The other two buttons use the same loop. One checks a Fieldglass receipt and should flag it instead of filing it. One compares Helios with the ledger and must not post anything.

Files

src/operator/company.ts holds the portal, the shared files, the ledger, and the rules. This is the file I change when I want a different bill or a different approval limit.

src/operator/run.ts is the loop, and the three saved goals.

src/operator/check.ts grades the books after the model stops.

src/operator/decision.ts reads the JSON, including when the model wraps it in a code fence.

server/model.ts is the prompt and the API call. The key stays on the server.

server/index.ts is POST /api/turn. It also caps each IP at 30 calls a minute.

src/components/desk/ is the page.

Why it is built this way

The company is fake so the same failure happens every time: the portal drops once, the draft is refused, the big bill waits. A real supplier site would be hard to show twice.

The prompt tells the model the rules, but the tools are what enforce them. Posting the draft returns an error. So does posting the wrong amount, or posting ₹3,12,400 before approval.

One tool per turn keeps the trace readable. A bad JSON reply gets one retry. It does not get to invent the next step.

Tests

npm test runs 13 tests and does not call a model.

operator.test.ts covers the company rules, the checker, and the parser.

run.test.ts drives the real loop with a scripted model: timeout then approval then post, a rejected approval, a premature "done", a draft, the 10-call cap, the receipt job, a question to a person, and an API error.

A script is not a live model. I still click the three jobs when a key is set, because a real run can take another path.

Limits

The portal, the folder, and the ledger are just data in company.ts. There is no real browser and no real accounts system.

The model only sees tool text. It does not see this page.

Only the three saved goals get a pass or fail. If you edit the goal text, the checker only shows what changed.

A refresh clears the run. There is no login. Do not deploy it with your key on a public URL.

If I had more time

I would grade any goal with the same rules, instead of matching the goal sentence exactly: no drafts, amount must match the portal, a large bill needs approval first. I would also save the run so a refresh does not wipe it.
