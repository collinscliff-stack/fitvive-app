# Fitvive: putting it online

This guide takes the Fitvive code and makes it a live website. Allow two to three hours the first time.
You can do it yourself, or hand this file to any web developer.

You will open four accounts, all in your own name:

| Account | What it does for Fitvive | Cost to start |
| --- | --- | --- |
| Supabase | Database, member logins, ID storage, server functions | Free tier |
| Daily | Live video | Free minutes each month, then per minute |
| Paystack | Payments in naira | A fee per payment |
| A web host, for example Netlify | Serves the website | Free tier |

Check each company's current prices before you launch. They change.

---

## Step 1. Create the database (Supabase)

1. Go to supabase.com, sign up, and create a **New project**. Choose a strong database password and keep it safe.
2. When the project is ready, open **SQL Editor**.
3. Open the file `supabase/schema.sql` from this folder, copy all of it, paste it into the editor, and press **Run**.
   It should finish with "Success". It is safe to run again later.

## Step 2. Connect the website to the database

1. In Supabase, open **Project Settings**, then **API** (or **API Keys**).
2. Copy the **Project URL**. Copy the **anon public** key (newer projects call it the **publishable** key).
3. Open `web/config.js` in any text editor and paste them in:

   ```js
   window.FITVIVE_CONFIG = {
     supabaseUrl: "https://your-project.supabase.co",
     supabaseAnonKey: "your-anon-or-publishable-key",
   };
   ```

Never paste the **service role** or **secret** key into this file. That key stays inside Supabase.

## Step 3. Put the website online

The `web` folder is the whole website. It needs no build step.

1. Upload the `web` folder to a web host. With Netlify you can drag the folder onto the page at app.netlify.com/drop.
2. The host gives you an address such as `https://fitvive.netlify.app`. Open it. You should see the Fitvive welcome page.
3. Later, connect your own domain (for example fitvive.ng) in the host's domain settings.

## Step 4. Tell Supabase your website address

1. In Supabase, open **Authentication**, then **URL Configuration**.
2. Set **Site URL** to your website address. Add the same address under **Redirect URLs**.
3. Emails: Supabase's built-in email sender only allows a few emails an hour.
   - For testing, open **Authentication > Sign In / Providers > Email** and switch off **Confirm email**.
   - Before launch, switch it back on and connect an email service under **Authentication > Emails > SMTP Settings**.

## Step 5. Make yourself the club admin

1. On your website, tap **Apply to join** and create your own account. Upload any image as the ID.
2. In Supabase **SQL Editor**, run this with your email:

   ```sql
   update public.profiles set role = 'admin', status = 'approved' where email = 'you@example.com';
   ```

3. Reload the website. You now see the **Club admin** menu.

From here you approve everyone else inside the app. You never need the SQL editor for members again.

## Step 6. Switch on live video (Daily)

1. Go to daily.co and sign up. In the Daily dashboard, open **Developers** and copy your **API key**.
2. In Supabase, open **Edge Functions**, then **Secrets**. Add a secret named `DAILY_API_KEY` with that key as the value.
3. Still in **Edge Functions**, choose **Deploy a new function** and pick the editor option.
   - Name it exactly `video-token`.
   - Replace the sample code with everything in `supabase/functions/video-token/index.ts`.
   - Deploy.

Test it: in the app, go to **Club admin > Members** and set your role to **Trainer** (or keep Admin). Go to
**Club admin > Sessions**, add a session starting in a few minutes with yourself as trainer, then open it from
**My sessions**. Log in as a second member on another phone and join. You should see each other.

## Step 7. Switch on payments (Paystack)

Until you finish this step, leave **Club admin > Fees and access > Require a paid membership** switched off.
While it is off, every approved member can join for free.

1. Open a Paystack business account at paystack.com and complete their verification.
2. In Paystack, open **Settings > API Keys & Webhooks**. Copy the **Secret Key**. Use the test key first.
3. In Supabase **Edge Functions > Secrets**, add:
   - `PAYSTACK_SECRET_KEY` = your Paystack secret key
   - `SITE_URL` = your website address, for example `https://fitvive.ng`
4. Deploy three more functions the same way as in step 6, each with the code from its folder:
   - `paystack-init`
   - `paystack-verify`
   - `paystack-webhook` — for this one, switch **Verify JWT** off in the function's settings. Paystack calls it
     without a Fitvive login, and the function checks Paystack's signature instead.
5. In Paystack **Settings > API Keys & Webhooks**, set the **Webhook URL** to:
   `https://YOUR-PROJECT.supabase.co/functions/v1/paystack-webhook`
6. In the app, open **Club admin > Fees and access**. Enter your fees in naira and save.
7. Make a test payment from **Membership** with Paystack's test card. Your status should change to **Active**.
8. When it works, replace the test secret key with your live key, then switch on **Require a paid membership**.

Automatic renewal is optional. Create a Plan in Paystack with the same amount as your fee, then paste its plan code
(it starts with `PLN_`) into **Fees and access**. Without a plan code, members pay once per period and pay again
when it ends.

If you have developers, they can deploy all four functions at once with the Supabase command line tool:
`supabase functions deploy`. The file `supabase/config.toml` already holds the right settings.

## Step 8. Open the club

1. **Members**: make your trainers. Each trainer applies like any member, you approve them, then set their role to Trainer.
2. **Sessions**: add the timetable. "Repeat daily for (days)" creates the same session on the following days.
3. **Fees and access**: add a founding member code if you want one, for example FOUNDER at 30% off.
4. Invite your founding members to apply. Approve them under **Applications** after checking each name against the ID.

---

## What each kind of user sees

- **Visitor**: welcome page, application form, log in.
- **Applicant**: ID upload, then a "pending" screen until you approve them.
- **Member**: home, timetable, live rooms, table tennis practice, partners (goals, chat, one-to-one video), ranking, membership, settings.
- **Trainer**: everything a member sees, plus **My sessions** and the broadcast view.
- **Company admin**: registers a company, buys seats, invites staff by email, books private sessions.
- **Club admin**: applications, members, sessions, reports, companies, fees and access.

## What has and has not been tested

Tested before this code was handed over:

- The database file was run on a real PostgreSQL server, with 38 checks on room placement, access rules, payments, partners and companies. All passed.
- Every screen was loaded at desktop and phone width with stand-in data. No errors and no sideways scrolling.

Not tested, because it needs your accounts and real phones:

- **Live video with Daily.** The code follows Daily's documented methods, but it has never run against the real service. Test with at least three phones before you invite members.
- **Paystack payments.** Same: test with Paystack's test key and test card first.
- **Supabase sign-up emails, ID upload and live updates** on a real Supabase project.

Expect to find and fix a few problems in those three areas on first contact. A developer can do this in a day or two.

## Limits to know about

- **Web app, not a store app.** Members open Fitvive in the phone browser. iPhone users should use Safari.
- **Screenshots cannot be blocked** in a browser. The code of conduct and the report button are the protection.
- **Games.** Table tennis is practice against the computer, played by dragging. Member-versus-member games and phone-swing play are not built.
- **Large sessions.** Each session is one Daily call split into rooms of six on screen. Check the participant limit of your Daily plan before a session with hundreds of members.
- **Women-only rooms** rely on the gender each member gives at sign-up. You confirm it against their ID when you approve them. Members cannot change it afterwards; you can, under Members.
- **Time zone.** Streaks and the weekly ranking use Lagos time.
- **Legal pages.** The Privacy and Terms pages are placeholders. Have a lawyer complete them before launch, including for the Nigeria Data Protection Act, because you hold ID documents.

## Before real members pay

1. Have a developer review the security settings and run through sign-up, video and payment.
2. Switch email confirmation back on with a proper email service.
3. Replace Paystack test keys with live keys.
4. Have a lawyer complete the Terms and Privacy pages.

## Update 2: a YouTube video in sessions

1. In Supabase, open SQL Editor, paste everything from `supabase/update-2-session-video.sql`, and click Run.
2. Copy your old `config.js` into the new `web` folder, then drag the `web` folder onto your Netlify site's Deploys page.
3. Trainers add a YouTube link on My sessions, or inside the live room under "Video for members". Admins can also add one when creating a session.
4. The video plays for everyone from the session's start time. The trainer can play, pause or restart it for everyone. The trainer's camera is optional.
