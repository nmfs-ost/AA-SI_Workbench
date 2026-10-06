# Storage costs

The Workbench estimates what the bucket's storage costs, so it can be read
next to the data and reported in dollars and cents.

## Where the figures are

- **Products** has a **$/month** column: what each file costs to keep for a
  month. Hover over a figure for the exact amount, the yearly amount, the
  file's size and its storage class. (The column gives way when the panel is
  very narrow; widen the panel to see it.)
- **Storage costs** (a tab in the middle of the window; or right-click a folder
  in Products → *Storage cost of this folder*) shows, for the whole bucket or
  one folder:
  - the cost **per month** and **per year**, and how much is stored;
  - the cost of each folder inside it (click one to look inside it);
  - the cost by storage class;
  - the largest products, with their monthly and yearly cost.

  The copy button puts a short text summary on the clipboard for a report or
  an email; the download button saves the figures as a CSV.

## How they are worked out

Each object's size in GiB times the price per GiB-month for the bucket's
location and the object's storage class. The prices are Google's list prices
from [cloud.google.com/storage/pricing](https://cloud.google.com/storage/pricing),
recorded in the Workbench with the date they were read (shown in the panel).
For a US region (us-central1, us-east1, us-east4) they are, per GiB-month:
Standard $0.020, Nearline $0.010, Coldline $0.004, Archive $0.0012. The US
multi-region and the nam4 dual-region have their own. If the bucket's location
cannot be read, or is one the Workbench has no price for, the panel says which
price it used instead.

These are estimates of **storage at rest only**. Operations (listing, reading,
writing), retrieval from the colder classes, early deletion (Nearline, Coldline
and Archive are billed for at least 30, 90 and 365 days) and network egress are
billed separately. Google's invoice is the record.

## Our own price

If the project pays a different price (a commitment, a discount, or storage
bought in advance), enter it under **Price used → Our own price** with a name
(for example *NOAA contract*) and press **Use it**. Every figure, in Products
and in Storage costs, then uses it and says so. **Back to the list price**
returns to Google's. The price is kept on the workstation,
`~/.config/aa-si-workbench/storage-price.json`.

## Large buckets

The totals list every object in the folder (its name, size and class only, a
thousand per request), so a bucket with hundreds of thousands of objects takes
a minute the first time. The figures are kept for ten minutes; the refresh
button counts again. At most 500,000 objects are counted; the panel says when
a folder has more.
