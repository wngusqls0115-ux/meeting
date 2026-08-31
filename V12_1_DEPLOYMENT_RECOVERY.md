# V12.1 Deployment Recovery

Purpose:
- avoid accidentally deploying an older same-named ZIP from Downloads
- print the exact failed regression item
- verify V12 large calendar and all locked baseline features before Git push

Deployment sequence:
1. Clone GitHub repository to a new timestamped folder.
2. Extract only `meeting_calendar_detail_v12_1.zip`.
3. Overlay package.
4. Confirm `PACKAGE_VERSION.txt` says `V12.1`.
5. Run Python syntax check.
6. Run JavaScript syntax check if Node is available.
7. Run `deployment_preflight_v12_1.py`.
8. Run the canonical `check_locked_features.py`.
9. Only then commit and push.

Important:
- V12.1 uses a new filename, so an older `meeting_calendar_detail_v12.zip`
  in Downloads cannot be selected accidentally.
