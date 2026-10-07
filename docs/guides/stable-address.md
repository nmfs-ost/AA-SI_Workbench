# A link to the Workbench that stays the same

The question: can opening the Workbench use the same link every session, so a
bookmark or a link in documentation keeps working? The answer is yes. For one
person nothing needs setting up. A link shared by a whole team needs an
administrator.

## What the address is

On a Google Cloud Workstation, a web app on port 8000 is reached at:

```
https://8000-<workstation>.<cluster>.cloudworkstations.dev/
```

The host part is the workstation's own. Cloud Workstations sets it inside the
workstation as `$WEB_HOST`. It is the same every time the workstation starts,
for as long as that workstation exists. The cluster part was chosen when the
cluster was made.

Why the link seems to change every session:

- **A one-time sign-in on the end.** A link that ends in
  `?_workstationAccessToken=…` signs the browser in, and the token is
  different every time. The address without it works on its own: opened
  directly, the browser signs in by a redirect to Google.
- **A different port.** The Workbench serves on 8000 unless told otherwise.
  Keep it on 8000.
- **A new workstation.** A deleted and re-created workstation, or one with
  another name, has another host. Stopping and starting the same workstation
  keeps its address.

## For you, now

1. Start the Workbench (`aa-workbench`). On a workstation it prints the
   address to keep:

   ```
   AA-SI Workbench
   → http://127.0.0.1:8000
   → https://8000-aa-jane.cluster-abc123.cloudworkstations.dev/   (open this in your browser and bookmark it …)
   ```

2. Bookmark that address. Next session: start the workstation, run
   `aa-workbench`, and open the bookmark.

`aa-workbench url` prints the address at any time. In the Workbench,
**Help ▸ Link to this Workbench…** shows it with a copy button. When the
Workbench is opened from a link with the sign-in token, it removes the token
from the address bar, so what you bookmark from there is the address to keep.

## The same address for any workstation, from your computer

With the Google Cloud CLI on your own computer, a tunnel brings the
Workbench to `http://localhost:8000`. That address is the same for every
workstation and every session:

```bash
gcloud workstations start-tcp-tunnel \
  --project=PROJECT --region=REGION --cluster=CLUSTER --config=CONFIG \
  WORKSTATION 8000 --local-host-port=localhost:8000 --start-workstation
```

- `--start-workstation` starts the workstation if it is stopped.
- Fill in the four names once, from the workstation's page in the Cloud
  console. `aa-workbench url` prints the command with the workstation's name
  already in it.
- Keep the command in a shell alias or script. The bookmark is then always
  `http://localhost:8000`.

## One address for a team (an administrator's job)

| Option | What people open | What it takes |
| --- | --- | --- |
| **Keep workstations** | `https://8000-<their workstation>.<cluster>.cloudworkstations.dev/` | Stop and start workstations instead of re-creating them, and name them after their user (for example `aa-jane`). This is a policy, not infrastructure. |
| **A custom domain** | `https://8000-<workstation>.aa.example.noaa.gov/` | A private cluster with Private Service Connect, an external Application Load Balancer, a wildcard certificate and a wildcard DNS record. The domain can only be set when the cluster is created. Each person still has their own address. |
| **A redirect service** | One link for everyone, e.g. `https://workbench.aa.example.noaa.gov/` | A small service (Cloud Run behind IAP) that knows who is signed in. It looks up that person's workstation with the Cloud Workstations API, reads its `host`, and redirects to `https://8000-<host>/`. Its service account needs `workstations.workstations.list` on the configuration. |

The redirect service is the only option that gives literally one link for
everyone. It is about 50 lines of code. It is not shipped here because it
runs in the team's project, under that project's identity and IAP setup.

## Sources

- [Access HTTP servers running on a workstation](https://cloud.google.com/workstations/docs/access-http-servers-running-on-workstations): the address format and `$WEB_HOST`.
- [Authenticate and set up API access within a workstation](https://cloud.google.com/workstations/docs/authentication): the sign-in redirect and `_workstationAccessToken`.
- [`gcloud workstations start-tcp-tunnel`](https://cloud.google.com/sdk/gcloud/reference/workstations/start-tcp-tunnel).
- [Set up custom domains for Cloud Workstations](https://cloud.google.com/workstations/docs/set-up-custom-domains-for-cloud-workstations).
