# Creditas scoring service

Creditas is the automated credit-scoring microservice used by a consumer lender to
**approve or decline personal-loan applications** for borrowers in the **European
Union**. An application submitted through the lender's website is scored here and
the decision (approve / decline) is returned and acted on automatically.

Because it decides access to credit for consumers, this is a **high-risk AI
system** under the EU AI Act (Annex III, point 5(b): evaluating creditworthiness
of natural persons).

## What it does

* Exposes an HTTP endpoint `POST /score` that takes an application (income, debt,
  employment history, requested amount, and applicant attributes) and returns an
  approval decision with a score.
* Loads a trained logistic-regression model and applies it to the application
  features.
* Calls an external credit-bureau API to enrich the application with a bureau
  score.

## Stack

Python 3 standard library only — `http.server` for the API, `pickle` for the
serialised model, `hashlib`/`hmac` for API keys. No third-party packages.

```sh
python3 tools/make_model.py                 # (re)generate models/model.pkl
python3 app/server.py                        # run the service on :8081
python3 -m unittest discover -s tests        # run the tests
```

## Layout

```
app/        service code (server, scoring, model, auth, bureau, config)
models/     the serialised logistic model (models/model.pkl)
tools/      make_model.py — trains and serialises the toy model
tests/      unit tests
```

## Model

The current model is a logistic regression over the application features. The
coefficients are in `tools/make_model.py`.
