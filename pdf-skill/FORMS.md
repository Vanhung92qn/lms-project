# FORMS.md — Form-filling Data Schema

This document is the **contract** for any agent preparing data that
will be fed into `fill_form.py`. Follow it exactly and the skill will
behave deterministically.

## 1. Top-level shape

The payload is **one flat JSON object** at the top level.

```json
{
  "field_name_1": "value",
  "field_name_2": "value",
  ...
}
```

No nesting. No arrays at the top level. Every key must be a string
that matches a PDF AcroForm field name exactly (case-sensitive).

Why flat: AcroForm field names form a flat namespace inside a PDF. If
the template uses dotted names (`student.full_name`), use the dotted
name as a literal JSON key — don't translate it into nested JSON.

## 2. Discovering field names

If you don't know the field names for a given template, introspect
them before writing the payload:

```bash
python pdf-skill/scripts/fill_form.py \
  --template path/to/template.pdf \
  --inspect
```

This prints a JSON object of `{ field_name: { type, current_value,
options? } }` to stdout and exits 0. Use it to design your payload.

## 3. Value types

| PDF field type | Accepted JSON value | Notes |
|----------------|---------------------|-------|
| Text field | string, number, boolean | Everything is coerced to `str()` before writing. |
| Checkbox | `true` / `false`, `"/Yes"` / `"/Off"` | We map `true` → `/Yes` and `false` → `/Off` for the common case. |
| Radio button group | string — the option value | Must match one of the radio's declared export values. |
| Dropdown (combo/list) | string — the option value | Same as radio. |
| Signature field | — | **Not supported** in MVP. Use a certificate/eID tool. |

Booleans written to text fields become the literal strings `"true"` /
`"false"`. If you need localized text, do the translation on your side
and pass the string.

## 4. Character encoding

- All strings are UTF-8. Vietnamese diacritics (`ễ ữ ạ …`) are fully
  supported provided the embedded font in the template supports them.
- If the PDF template was authored with a Latin-only font, glyphs may
  render as `?` or empty boxes. The fix is to re-author the template
  with a Unicode font; the skill cannot fix rendering.

## 5. Dates, numbers, currency

The skill does no formatting — it writes whatever string the caller
provides. Format on your side to the convention the PDF template
expects. Recommended conventions for AI-LMS templates:

- Dates: `DD/MM/YYYY` (e.g. `"19/04/2026"`) for Vietnamese-facing
  documents, `YYYY-MM-DD` for internal / English documents.
- Numbers: thousands-separated with `.` for `vi-VN`
  (e.g. `"1.500.000"`), plain integer for internal.
- Currency: `"1.500.000 ₫"` (space + currency glyph) for a VN
  audience; the raw integer is available separately if needed.

## 6. Canonical schemas used inside AI-LMS

These are the contracts the backend will use when it integrates the
skill. New templates **must** either reuse one of these shapes or add
a new section here with a code review.

### 6.1 `certificate_of_completion`

Template purpose: issued when a student finishes a course.

```json
{
  "student_full_name": "Nguyễn Văn Hùng",
  "student_id":        "SV2026-0001",
  "course_title":      "C++ từ căn bản đến nâng cao",
  "course_code":       "KH-CPP-01",
  "issued_on":         "19/04/2026",
  "issued_by":         "khohoc.online",
  "certificate_code":  "KH-CERT-2026-00000123",
  "verification_url":  "https://khohoc.online/cert/KH-CERT-2026-00000123",
  "grade":             "A",
  "mentor_name":       "Trần Thị B"
}
```

### 6.2 `invoice_vnd`

Template purpose: VND-denominated invoice for a paid course.

```json
{
  "invoice_number":  "INV-2026-000045",
  "issued_on":       "19/04/2026",
  "buyer_name":      "Nguyễn Văn Hùng",
  "buyer_email":     "hung@example.com",
  "buyer_address":   "123 Nguyễn Trãi, Thanh Xuân, Hà Nội",
  "course_title":    "C++ từ căn bản đến nâng cao",
  "course_code":     "KH-CPP-01",
  "amount_net":      "1.500.000",
  "amount_vat":      "150.000",
  "amount_total":    "1.650.000 ₫",
  "payment_method":  "VNPay",
  "payment_txn_id":  "1712345678-VNPAY"
}
```

### 6.3 `student_enrollment_form`

Template purpose: an intake form a teacher uploads; filled from
account data on enrollment.

```json
{
  "full_name":      "Nguyễn Văn Hùng",
  "date_of_birth":  "12/08/2001",
  "gender":         "male",
  "phone":          "+84 912 345 678",
  "email":          "hung@example.com",
  "student_id":     "SV2026-0001",
  "course_title":   "C++ từ căn bản đến nâng cao",
  "enrolled_on":    "19/04/2026",
  "agrees_to_tos":  true
}
```

## 7. Validation before calling the skill

The skill itself validates only that the payload is a JSON object
with string keys. The caller is responsible for:

- Type coercion (e.g. converting a `Date` object to a Vietnamese
  date string).
- Length constraints (most AcroForm fields truncate silently; long
  names in a narrow field look bad).
- Ensuring no PII leaks outside the intended template (the skill does
  not scrub — what you send is what gets written).

## 8. Examples of invalid payloads

- `[{ "full_name": "..." }]` — **invalid**, top-level must be an
  object, not an array.
- `{ "student": { "name": "..." } }` — **invalid**, nested objects
  are not flattened automatically.
- `{ "full_name": null }` — **valid**; `null` becomes the string
  `"None"` which is almost certainly not what you want. Omit the key
  instead.
- `{ "full_name": ["Nguyễn", "Văn", "Hùng"] }` — **valid** but
  written as `"['Nguyễn', 'Văn', 'Hùng']"`. Join on your side.
