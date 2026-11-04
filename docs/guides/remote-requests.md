# Remote requests: preparing data for another app

Another Google Cloud app (a metadata manager, say) can ask the Workbench on a
chosen workstation to prepare a survey's time range: EchoData, then calibrated
Sv, as Zarr in the bucket. It's the same thing the **Prepare EchoData** panel
does when you press Prepare. The app sends a short request over HTTPS; the
Workbench works out which raw files cover the range and starts the run.

## On the workstation (its user)

**Tools ▸ Remote Requests…**

1. Turn on **Accept remote requests on this workstation**. It's off until you
   do.
2. List the accounts that may start a run, one per line, for example the
   metadata manager's service account. A request from any other account isn't
   run. It waits in the same dialog, where you can **Run it**, **Always allow**
   its account, or **Discard** it.
3. **Save.**

A run started this way is yours, exactly as if you had pressed Prepare: it uses
your account and your folder (`derived_products/<you>/…`), and its costs are
yours. It shows in the Prepare panel and the Processing Queue like any other
run.

What a request **can't** do:
- choose the bucket: products always go to your folder in this workstation's
  bucket;
- choose a working folder on this machine, or keep files on it;
- carry commands of its own;
- run anything but a Prepare.

It can choose the time range, the source (one of yours), whether to make Sv
and an echogram, NetCDF or Zarr, and the result's name. A field it doesn't
know is an error, not ignored.

## Before an app can call it

- **The app needs access to the workstation.** Cloud Workstations' gateway
  only lets through accounts with access to that workstation (the Cloud
  Workstations User role on it). **That access opens all of the Workbench**,
  terminal included, not just this endpoint, so grant it only to accounts you
  would trust with the workstation.
- **The workstation must be running, with the Workbench serving**
  (`aa-workbench`). A stopped workstation can be started through the
  Workstations API, but the Workbench doesn't start by itself.

## Calling it (the app)

Two tokens go with each call:

| Header | What | Why |
|---|---|---|
| `Authorization: Bearer …` | an access token from `workstations.generateAccessToken` | gets through Cloud Workstations' gateway |
| `X-AA-Identity: …` | a Google ID token for the app's own account, with its email; its audience is **this workstation's address** (Tools ▸ Remote Requests shows it, e.g. `https://8000-aa-jane.cluster-….cloudworkstations.dev`) | tells the Workbench who's asking |

The Workbench checks the ID token's signature with Google, its expiry, its
audience and that its email is verified, then looks the email up in its list.
Because the audience is the workstation's own address, a token made for one
workstation is no use on another. Off a workstation, the audience is
`aa-si-workbench`.

```
POST https://<port>-<workstation host>/api/remote/prepare
```

```json
{
  "vessel": "Henry_B._Bigelow",
  "survey": "HB1603",
  "sonar": "EK60",
  "start": "2016-07-03T06:00:00",
  "end": "2016-07-03T12:00:00",
  "note": "for the Zarr test"
}
```

- Names are the source's own, as the Prepare panel lists them (NCEI writes
  `Henry_B._Bigelow`).
- Times are UTC.
- Optional fields, with their defaults: `"source": "ncei"`,
  `"streamed": true` (file by file into the bucket; the EchoData is Zarr),
  `"format": "zarr"`, `"sv": true`, `"echogram": true`, `"base": ""`
  (default: `<survey>_<sonar>_<start>-<end>`), `"waveformMode": "CW"` and
  `"encodeMode": "complex"` (EK80), `"gapSeconds": 900`, `"gapFactor": 6`.

The answer (HTTP 202):

```json
{"id": "3f2a9c1b7d4e", "status": "started", "runId": "a1b2c3d4e5",
 "destination": "gs://…/derived_products/jane/Henry_B._Bigelow/HB1603/HB1603_EK60_…/",
 "runState": "running", "detail": ""}
```

The `status` is one of:
- `started`;
- `held`: the account isn't on the list, so the request waits for the user;
- `refused`: HTTP 409, with the reason in `detail`. For example, no files
  cover the range, or there isn't enough working space.

Other errors:
- 400 or 422: something in the request is wrong (the answer says which field);
- 401: no ID token, or an unacceptable one;
- 403: remote requests are switched off;
- 429: too many requests are already waiting for the user.

Follow a request with `GET /api/remote/requests/<id>`, sending the same two
headers. Only the account that sent a request can follow it.

### Python, from a service account (Cloud Run, a VM, …)

```python
import google.auth
import google.auth.transport.requests
import requests
from google.oauth2 import id_token

WORKSTATION = ("projects/PROJECT/locations/REGION/workstationClusters/CLUSTER/"
               "workstationConfigs/CONFIG/workstations/WORKSTATION")
URL = "https://8000-WORKSTATION_HOST"          # Tools ▸ Remote Requests shows it

auth = google.auth.transport.requests.Request()
creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
creds.refresh(auth)
gateway = requests.post(
    f"https://workstations.googleapis.com/v1/{WORKSTATION}:generateAccessToken",
    headers={"Authorization": f"Bearer {creds.token}"},
    json={"port": 8000},
).json()["accessToken"]
identity = id_token.fetch_id_token(auth, URL)   # audience: the address; includes the email

answer = requests.post(
    f"{URL}/api/remote/prepare",
    headers={"Authorization": f"Bearer {gateway}", "X-AA-Identity": identity},
    json={"vessel": "Henry_B._Bigelow", "survey": "HB1603", "sonar": "EK60",
          "start": "2016-07-03T06:00:00", "end": "2016-07-03T12:00:00"},
)
print(answer.status_code, answer.json())
```

### From a terminal, for testing

As a service account (impersonated):

```bash
URL=https://8000-WORKSTATION_HOST      # as Tools ▸ Remote Requests shows it
IDENTITY=$(gcloud auth print-identity-token --impersonate-service-account=APP@PROJECT.iam.gserviceaccount.com \
  --audiences=$URL --include-email)
```

As yourself: a person's gcloud ID token can't have the workstation's address
as its audience. Tick **Also accept a person's own gcloud token** in the
dialog, then use `IDENTITY=$(gcloud auth print-identity-token)`. Untick it
when you're done testing: such a token isn't tied to this workstation, so one
you've sent elsewhere would work here too, for the hour it lasts.

Then:

```bash
WS=projects/PROJECT/locations/REGION/workstationClusters/CLUSTER/workstationConfigs/CONFIG/workstations/WORKSTATION
GATEWAY=$(curl -sS -X POST "https://workstations.googleapis.com/v1/$WS:generateAccessToken" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  -d '{"port": 8000}' | python3 -c 'import json, sys; print(json.load(sys.stdin)["accessToken"])')
curl -sS -X POST "$URL/api/remote/prepare" \
  -H "Authorization: Bearer $GATEWAY" -H "X-AA-Identity: $IDENTITY" -H "Content-Type: application/json" \
  -d '{"vessel":"Henry_B._Bigelow","survey":"HB1603","sonar":"EK60","start":"2016-07-03T06:00:00","end":"2016-07-03T07:00:00"}'
```
