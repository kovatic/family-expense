# Parser fixtures

Files named `synthetic_*` are **made up** to exercise the parser framework (amounts, dates,
debit/credit wording, HTML handling). They are *not* real SBI or HDFC email formats and passing
them says nothing about compatibility with real bank emails.

To verify a bank parser, add sanitized real emails next to them, e.g. `sbi/debit_upi.txt`,
`sbi/credit.txt`, `hdfc/debit_upi.html`, and expected values in `tests/unit/parsers.test.ts`.
Format: header lines (`From:`, `Subject:`, `Date:`), a blank line, then the body. A body starting
with `<` is treated as HTML.

Sanitize before committing: name, full account number, address, phone, UPI IDs of people, and
(optionally) reference numbers. Keep the sender, subject, wording, and amount/date/narration
formats exactly as received.
