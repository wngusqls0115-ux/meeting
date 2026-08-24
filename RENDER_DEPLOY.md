# Render deployment

Repository:
https://github.com/wngusqls0115-ux/meeting

## Render
1. Sign in at https://dashboard.render.com
2. New + -> Blueprint
3. Connect GitHub repository `wngusqls0115-ux/meeting`
4. Render reads `render.yaml`
5. Enter these secret values:
   - APP_ADMIN_EMAIL
   - APP_ADMIN_PASSWORD
   - PLAUD_WEBHOOK_SECRET
   - OPENAI_API_KEY
6. Deploy.
7. Open the generated `https://...onrender.com` address.

## Access rule
The public URL can be opened by anyone, but meeting-content APIs require a valid login session.

## Persistent data
SQLite is stored at `/app/data/meetings.db`, backed by a Render persistent disk.

## Custom domain
After the app works:
Service -> Settings -> Custom Domains
Then connect your registered domain and verify DNS.
