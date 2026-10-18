# MediLin — telehealth backend

MediLin is a telehealth service for **Romania and Germany** (EU). Patients create
an account, book video appointments with a clinician, write down the symptoms they
want to discuss, and get a first orientation from an **AI triage assistant** before
the consultation.

This repository is the backend API and a small patient web frontend.

## Who uses it

* **Patients** — consumers in Romania and Germany. They register with an email and
  password, book appointments and enter free-text symptom notes.
* **Clinicians** — see the booked appointments and the patient's symptom notes and
  the triage summary.

The service processes **health data** (symptoms, appointment reasons) and contact
details, so it is a processor of special-category personal data under the GDPR.

## Components

* `src/server.js` — HTTP API (Node.js built-in `node:http`, no framework).
* `src/db/` — a tiny SQL-style data layer over an in-process store (stands in for
  the production PostgreSQL driver; same query strings are used).
* `src/routes/` — account, appointment, notes and triage endpoints.
* `src/triage/` — the AI triage assistant. It sends the patient's symptom text to
  an LLM and turns the reply into a structured triage result and a follow-up
  action (book urgent, book routine, self-care advice).
* `public/index.html` — the patient-facing single page.

## Running

No third-party dependencies — everything uses the Node.js standard library.

```sh
npm start          # starts the API on :8080
npm test           # unit tests (node --test), fully offline
```

The triage assistant calls the Anthropic Messages API. Set `ANTHROPIC_API_KEY` in
the environment. `TRIAGE_MODEL` defaults to `claude-opus-5-5`.

## Deployment

Containerised (see `Dockerfile`) and deployed to our EU cloud region behind a load
balancer. Google Analytics is used on the patient page to understand usage.
