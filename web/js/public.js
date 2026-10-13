// Screens for visitors and for people whose application is not approved yet.
import { sb, S, uid, app, $, esc, toast, q, head, icon, friendly } from './core.js';

const ui = { notice: '', err: '' };
const here = () => location.origin + location.pathname;

const LEGAL = {
  conduct: ['Code of conduct', [
    'Fitvive is a private club. Every member is verified with a photo ID.',
    'Do not record, screenshot or share video or images of other members.',
    'No harassment, insults, sexual comments or unwanted contact, in rooms or in chat.',
    'Dress and behave as you would in a gym where colleagues and clients might see you.',
    'One strike: a member who breaks these rules is removed with no refund.',
    'Report anything that worries you with the flag on a member\'s video. The club reviews every report.',
  ]],
  privacy: ['Privacy', [
    'Your photo ID is used only to verify who you are. Only club admins can open it.',
    'Your camera is optional. You can join any room with the camera off.',
    'Other members see your first name and the first letter of your surname.',
    'Live video is not recorded by Fitvive.',
    'Bets or stakes between members are private. Fitvive does not hold, record or take a cut of any money for them.',
    '[Have a lawyer complete this page so it meets the Nigeria Data Protection Act before launch.]',
  ]],
  terms: ['Terms', [
    'Membership is personal and cannot be shared.',
    'Fees are paid monthly or yearly, in advance.',
    'Exercise at your own pace and ask a doctor first if you have a health condition.',
    '[Have a lawyer write the full terms before launch.]',
  ]],
};

export const views = {
  setup: {
    render: () => `<section class="card glow">${head('Setup needed', 'Fitvive is not <i>connected</i> yet.', 'Open the file config.js and paste in your Supabase project URL and anon key. The steps are in SETUP.md.')}</section>`,
  },

  landing: {
    render: () => `<section class="card glow hero"><p class="eyebrow">Online fitness club</p><h1>Work out together, <i>wherever you are.</i></h1><p class="lede">Log in from home or the gym, see other members training live, and join a workout or a quick game. Members only.</p><div class="row"><a class="btn gold" href="#/apply">Apply to join</a><a class="btn" href="#/login">Log in</a></div></section>
<section class="cols"><div class="card stat">${icon('video')}<h3>Live workout rooms</h3><p class="meta">Six members and a trainer on screen. Wherever you are, you feel the vibe.</p></div><div class="card stat">${icon('calendar')}<h3>Trainer sessions</h3><p class="meta">Morning workouts, midday desk breaks, evening dance and weekend challenges. 15 to 30 minutes each.</p></div><div class="card stat">${icon('users')}<h3>Workout partners</h3><p class="meta">Pick a member, train side by side on video, and set goals together.</p></div><div class="card stat">${icon('building')}<h3>For companies</h3><p class="meta">Buy seats for your staff and get a private room for your team.</p></div></section>
<section class="card">${head('How joining works', 'Four steps to your first session')}<ol class="list" style="padding:0;margin:0"><li class="item"><span class="it">1. Apply</span><span class="meta grow">Your name, phone and a photo ID.</span></li><li class="item"><span class="it">2. Approval</span><span class="meta grow">The club reviews every application.</span></li><li class="item"><span class="it">3. Membership</span><span class="meta grow">Pay monthly or yearly.</span></li><li class="item"><span class="it">4. Join a room</span><span class="meta grow">Camera on or off. Your choice.</span></li></ol></section>
<p class="note"><a href="#/legal/conduct">Code of conduct</a> · <a href="#/legal/privacy">Privacy</a> · <a href="#/legal/terms">Terms</a></p>`,
  },

  apply: {
    render: () => ui.notice
      ? `<section class="card glow">${head('Almost there', 'Check your <i>email.</i>', esc(ui.notice))}<div class="row"><a class="btn gold" href="#/login">Log in</a></div></section>`
      : `<section class="card">${head('Apply to join', 'Tell us who you are', 'Every member is verified. No anonymous accounts.')}
<form class="stack" data-form="apply" novalidate>
<div class="row" style="align-items:flex-start"><div class="field"><label for="ap-name">Full name, as on your ID</label><input type="text" id="ap-name" autocomplete="name" required></div><div class="field"><label for="ap-phone">Phone number</label><input type="tel" id="ap-phone" autocomplete="tel" required></div></div>
<div class="row" style="align-items:flex-start"><div class="field"><label for="ap-email">Email</label><input type="email" id="ap-email" autocomplete="email" required></div><div class="field"><label for="ap-pass">Password (8 characters or more)</label><input type="password" id="ap-pass" autocomplete="new-password" required></div></div>
<div class="row" style="align-items:flex-start"><div class="field"><label for="ap-gender">Gender (used for women-only rooms)</label><select id="ap-gender"><option value="">Choose</option><option value="female">Female</option><option value="male">Male</option></select></div><div class="field"><label for="ap-ref">Referral code or member's name (optional)</label><input type="text" id="ap-ref"></div></div>
<label class="check" for="ap-code"><input type="checkbox" id="ap-code"><span>I agree to the <a href="#/legal/conduct">code of conduct</a>: no recording, no harassment, one strike and removal.</span></label>
${ui.err ? `<p class="err">${esc(ui.err)}</p>` : ''}
<div class="row"><button class="btn gold" type="submit">Create my account</button></div>
<p class="meta">Next you upload a photo ID, then the club reviews your application.</p>
</form></section>`,
    forms: {
      async apply() {
        const v = (id) => $('#' + id).value.trim();
        const fail = (m) => { ui.err = m; return app.refresh(); };
        if (v('ap-name').split(/\s+/).length < 2) return fail('Enter your first name and surname.');
        if (v('ap-phone').replace(/\D/g, '').length < 7) return fail('Enter a phone number we can reach you on.');
        if (!/.+@.+\..+/.test(v('ap-email'))) return fail('Enter a valid email address.');
        if ($('#ap-pass').value.length < 8) return fail('Use a password of 8 characters or more.');
        if (!v('ap-gender')) return fail('Choose your gender. It decides who can enter women-only rooms.');
        if (!$('#ap-code').checked) return fail('Agree to the code of conduct to apply.');
        ui.err = '';
        const { data, error } = await sb.auth.signUp({
          email: v('ap-email'), password: $('#ap-pass').value,
          options: { emailRedirectTo: here(), data: { full_name: v('ap-name'), phone: v('ap-phone'), gender: v('ap-gender'), referral_code: v('ap-ref'), conduct: 'true' } },
        });
        if (error) return fail(friendly(error.message));
        if (!data.session) { ui.notice = 'We sent a confirmation link to ' + v('ap-email') + '. Open it, then log in to upload your ID.'; await app.refresh(); }
      },
    },
  },

  login: {
    render: () => `<section class="card" style="max-width:480px">${head('Log in', 'Welcome <i>back.</i>')}<form class="stack" data-form="login" novalidate><div class="field" style="flex:none"><label for="li-email">Email</label><input type="email" id="li-email" autocomplete="email" required></div><div class="field" style="flex:none"><label for="li-pass">Password</label><input type="password" id="li-pass" autocomplete="current-password" required></div><button class="btn gold" type="submit">Log in</button><button class="linkbtn" type="button" data-act="forgot" style="align-self:flex-start">Forgot your password?</button><a href="#/apply">Not a member yet? Apply to join</a></form></section>`,
    forms: {
      async login() {
        const { error } = await sb.auth.signInWithPassword({ email: $('#li-email').value.trim(), password: $('#li-pass').value });
        if (error) throw new Error(error.message);
      },
    },
    actions: {
      async forgot() {
        const email = $('#li-email').value.trim();
        if (!/.+@.+\..+/.test(email)) throw new Error('Type your email above first, then tap this again.');
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
        if (error) throw new Error(error.message);
        toast('Check your email for a link to set a new password.');
      },
    },
  },

  newpassword: {
    render: () => `<section class="card" style="max-width:480px">${head('Password', 'Set a new <i>password.</i>')}<form class="stack" data-form="newpass" novalidate><div class="field" style="flex:none"><label for="np-pass">New password (8 characters or more)</label><input type="password" id="np-pass" autocomplete="new-password"></div><button class="btn gold" type="submit">Save password</button></form></section>`,
    forms: {
      async newpass() {
        const p = $('#np-pass').value;
        if (p.length < 8) throw new Error('Use a password of 8 characters or more.');
        const { error } = await sb.auth.updateUser({ password: p });
        if (error) throw new Error(error.message);
        S.recovery = false;
        toast('Password saved.');
        location.hash = '#/home';
        await app.refresh();
      },
    },
  },

  legal: {
    render: (_, params) => {
      const doc = LEGAL[params[0]] || LEGAL.conduct;
      return `<section class="card">${head('Fitvive', esc(doc[0]))}<ul class="list">${doc[1].map((t) => `<li class="item"><span class="grow">${esc(t)}</span></li>`).join('')}</ul></section><p class="note"><a href="#/legal/conduct">Code of conduct</a> · <a href="#/legal/privacy">Privacy</a> · <a href="#/legal/terms">Terms</a> · <a href="#/">Back</a></p>`;
    },
  },

  noprofile: {
    render: () => `<section class="card">${head('Account', 'Your profile is <i>missing.</i>', 'Your login works but the club has no record for it. Log out and apply again, or contact the club.')}</section>`,
  },

  // Signed in, but not approved yet.
  onboarding: {
    render: () => {
      const p = S.profile;
      if (p.status === 'rejected') return `<section class="card">${head('Application', 'Your application was <i>not approved.</i>', 'Contact the club if you think this is a mistake.')}</section>`;
      if (p.status === 'suspended') return `<section class="card">${head('Account', 'Your membership is <i>suspended.</i>', 'Contact the club to find out why.')}</section>`;
      if (p.status === 'removed') return `<section class="card">${head('Account', 'Your membership has <i>ended.</i>', 'You were removed for breaking the code of conduct.')}</section>`;
      if (!p.id_doc_path) {
        return `<section class="card">${head('Step 2 of 2', 'Upload your <i>photo ID.</i>', 'A national ID card, driver\'s licence, voter\'s card or passport. Only club admins can see it.')}
<form class="stack" data-form="iddoc" novalidate><div class="field" style="flex:none"><label for="ob-id">Photo or scan of your ID (image or PDF, up to 10 MB)</label><input type="file" id="ob-id" accept="image/*,.pdf"></div><div class="row"><button class="btn gold" type="submit">Send for review</button></div></form></section>`;
      }
      return `<section class="card glow">${head('Application received', 'Your application is <i>pending.</i>', 'The club reviews your ID before you can enter. Come back and log in to check.')}<div class="row"><button class="btn" data-act="check">Check again</button></div></section>`;
    },
    forms: {
      async iddoc() {
        const file = $('#ob-id').files[0];
        if (!file) throw new Error('Choose a photo or scan of your ID first.');
        if (file.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB. Use a smaller photo.');
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
        const path = `${uid()}/${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('id-docs').upload(path, file, { contentType: file.type || undefined });
        if (error) throw new Error(error.message);
        await q(sb.from('profiles').update({ id_doc_path: path }).eq('id', uid()));
        toast('ID sent. The club will review it.');
        await app.reloadProfile();
      },
    },
    actions: {
      async check() { await app.reloadProfile(); if (S.profile?.status === 'approved') location.hash = '#/home'; else toast('Still pending.'); },
    },
  },
};
