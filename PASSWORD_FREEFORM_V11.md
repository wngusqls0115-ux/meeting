# V11 — Free-form Password Policy

User-approved change to the locked baseline.

Password rules:
- no minimum length
- no uppercase requirement
- no lowercase requirement
- no number requirement
- no special-character requirement
- Korean, English, numbers, symbols, and spaces are allowed
- password is stored/verified exactly as entered
- only the empty string is rejected

Applies to:
- user password change
- administrator-created user initial password
- administrator password reset

Unchanged:
- password hashing (PBKDF2-HMAC-SHA256)
- login requirement
- session invalidation after password change/reset
- all V10 locked application features
