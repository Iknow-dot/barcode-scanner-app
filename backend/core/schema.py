"""drf-spectacular helpers for the separate external-integration API schema.

The main schema (``/api/schema/`` → ``/api/redoc/``) documents the whole app,
which is JWT-authenticated and consumed by our own frontend. External systems
(a customer's 1C ConsultWebExchange) only ever call the two *catalog ingest*
endpoints, with a completely different auth model (a per-org push token). To
give integrators a focused contract, ``/api/integration/schema/`` reuses
``SpectacularAPIView`` with ``custom_settings`` that (a) swap in the onboarding
guide below as the schema description and (b) apply the preprocessing hook here
to keep ONLY the ingest endpoints.

Path-prefix filtering can't separate them (ingest, name-search and the image
proxy all live under ``catalog/products/``), so the hook filters by view class.
"""

INTEGRATION_DESCRIPTION = """\
# Catalog Integration API

Push your product catalog into the Barcode Scanner platform. Your 1C system is
the **source of truth**; you push changes to us and we keep a fast local replica
that powers barcode scan and name search. **Stock and price are never stored** —
we always fetch those live from your 1C at scan time.

## Authentication

Every request must carry your organization's **push token**, sent as either:

- `X-Webhook-Token: <token>`, or
- `Authorization: Bearer <token>`

The token *identifies your organization* — you never send an organization id in
the body, and a token can only ever write your own catalog. Keep it secret; it
can be rotated on request.

## The two operations

| Operation | Endpoint | When |
|-----------|----------|------|
| **Upsert products** | `POST /api/v1/catalog/products/` | Onboarding (full catalog) and every later change |
| **Deactivate products** | `POST /api/v1/catalog/products/deactivate/` | When a product is discontinued |

## Onboarding vs. steady state

- **Onboarding / re-baseline:** send your whole catalog to `POST /catalog/products/`
  with `is_full: true`. You may page it — send many requests, each with a chunk
  of `products` (optionally tagged with `page`). Order doesn't matter.
- **Steady state:** send only what changed to the same endpoint (omit `is_full`),
  and send explicit `deactivate` calls for discontinued SKUs.

## Idempotency & retries

Every batch is processed independently and idempotently. We fingerprint each row;
**re-sending an unchanged product is a no-op** (`skipped`), so you can safely
retry a failed batch or re-push a full snapshot at any time to re-baseline. A
previously deactivated SKU that you push again is automatically reactivated.

## Deactivation

Deactivated products are **soft-deleted** — hidden from search but kept forever,
so order history keeps resolving them and seasonal items reactivate for free when
you push them again.

## Images

Send absolute image URLs in `image_urls`. We fetch them from your host (with your
1C credentials) and serve them to consultants through an authenticated proxy — we
do not copy or store the image files. Image URLs are expected to live on the same
host as your web service.

---

# კატალოგის ინტეგრაციის API

ატვირთეთ თქვენი პროდუქტების კატალოგი Barcode Scanner პლატფორმაზე. თქვენი 1C სისტემა
არის **ჭეშმარიტების წყარო (source of truth)**; თქვენ გვიგზავნით ცვლილებებს, ჩვენ კი
ვინახავთ სწრაფ ლოკალურ ასლს (replica), რომელიც უზრუნველყოფს შტრიხკოდითა და
დასახელებით ძებნას. **მარაგი და ფასი არასდროს ინახება** — ისინი ყოველთვის იტვირთება
პირდაპირ თქვენი 1C-დან სკანირების მომენტში.

## ავთენტიფიკაცია

ყოველ მოთხოვნას უნდა ახლდეს თქვენი ორგანიზაციის **push token**, გაგზავნილი ერთ-ერთი
გზით:

- `X-Webhook-Token: <token>`, ან
- `Authorization: Bearer <token>`

token **განსაზღვრავს თქვენს ორგანიზაციას** — თქვენ არასდროს აგზავნით ორგანიზაციის
იდენტიფიკატორს მოთხოვნის სხეულში, და token-ს შეუძლია მხოლოდ თქვენივე კატალოგში ჩაწერა.
შეინახეთ ის საიდუმლოდ; საჭიროებისამებრ მისი განახლება (rotate) შესაძლებელია.

## ორი ოპერაცია

| ოპერაცია | Endpoint | როდის |
|----------|----------|-------|
| **პროდუქტების ატვირთვა / განახლება** | `POST /api/v1/catalog/products/` | ჩართვისას (სრული კატალოგი) და ყოველი ცვლილებისას |
| **პროდუქტების დეაქტივაცია** | `POST /api/v1/catalog/products/deactivate/` | როცა პროდუქტი იხსნება მიმოქცევიდან |

## ჩართვა (Onboarding) vs. მუდმივი რეჟიმი

- **ჩართვა / ხელახალი სინქრონიზაცია:** გაგზავნეთ მთელი კატალოგი
  `POST /catalog/products/`-ზე `is_full: true`-ით. შეგიძლიათ დაყოთ გვერდებად — გაგზავნეთ
  რამდენიმე მოთხოვნა, თითოეული `products`-ის ნაწილით (სურვილისამებრ `page`-ით მონიშნული).
  თანმიმდევრობას მნიშვნელობა არ აქვს.
- **მუდმივი რეჟიმი:** გაგზავნეთ მხოლოდ შეცვლილი მონაცემები იმავე endpoint-ზე (`is_full`
  გამოტოვეთ), და გაგზავნეთ ცალკე `deactivate` მოთხოვნები მოხსნილი SKU-ებისთვის.

## იდემპოტენტურობა და ხელახალი გაგზავნა

ყოველი პაკეტი (batch) მუშავდება დამოუკიდებლად და იდემპოტენტურად. ჩვენ ვიღებთ თითოეული
ჩანაწერის „თითის ანაბეჭდს" — **უცვლელი პროდუქტის ხელახალი გაგზავნა უშედეგოა** (`skipped`),
ამიტომ უსაფრთხოდ შეგიძლიათ წარუმატებელი პაკეტის ხელახლა გაგზავნა ან სრული კატალოგის
ხელახალი ატვირთვა ნებისმიერ დროს. ადრე დეაქტივირებული SKU, რომელსაც ხელახლა აგზავნით,
ავტომატურად აქტიურდება.

## დეაქტივაცია

დეაქტივირებული პროდუქტები **რბილად იშლება (soft-delete)** — იმალება ძებნიდან, მაგრამ
ინახება სამუდამოდ, ასე რომ შეკვეთების ისტორია მათ კვლავ ცნობს, სეზონური პროდუქტები კი
უფასოდ აქტიურდება ხელახალი გაგზავნისას.

## სურათები

გაგზავნეთ სურათების აბსოლუტური URL-ები `image_urls`-ში. ჩვენ ჩამოვტვირთავთ მათ თქვენი
ჰოსტიდან (თქვენივე 1C credentials-ით) და მივაწოდებთ კონსულტანტებს ავთენტიფიცირებული
proxy-ის მეშვეობით — ფაილებს არ ვაკოპირებთ და არ ვინახავთ. მოსალოდნელია, რომ სურათების
URL-ები იმავე ჰოსტზეა, სადაც თქვენი ვებ-სერვისი.
"""


def integration_endpoints_only(endpoints):
    """Preprocessing hook: keep only the endpoints an external system calls.

    ``endpoints`` is a list of ``(path, path_regex, method, callback)`` tuples.
    We keep the two catalog-ingest views and drop everything else, so the
    integration ReDoc shows the partner contract in isolation. Imported lazily
    to avoid a circular import at settings/url load time.
    """
    from core.views import (
        CatalogProductIngestAPIView,
        CatalogProductDeactivateAPIView,
    )

    allowed = {CatalogProductIngestAPIView, CatalogProductDeactivateAPIView}
    return [
        (path, path_regex, method, callback)
        for (path, path_regex, method, callback) in endpoints
        if getattr(callback, "cls", None) in allowed
    ]
