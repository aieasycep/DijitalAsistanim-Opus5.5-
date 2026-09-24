import { EXTERNAL_LINKS } from '../../lib/site.ts';
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '../meta.ts';
import {
  link,
  mail,
  md,
  p,
  page,
  strong,
  ul,
  type Block,
  type LegalContext,
  type LegalDocument,
} from './types.ts';

/** Privacy Policy, English translation of `privacy.tr.ts` (the Turkish text prevails). */
export function privacyEn(ctx: LegalContext): LegalDocument {
  const c = ctx.company;
  const controller: Block = {
    type: 'dl',
    items: [
      { term: 'Data controller', desc: [c.displayName] },
      ...(c.address === undefined ? [] : [{ term: 'Address', desc: [c.address] }]),
      ...(c.mersisNo === undefined ? [] : [{ term: 'MERSIS number', desc: [c.mersisNo] }]),
      ...(c.kepAddress === undefined
        ? []
        : [{ term: 'KEP (registered email) address', desc: [c.kepAddress] }]),
      { term: 'Privacy contact', desc: [mail(c.privacyEmail)] },
      ...(c.euRepresentative === undefined
        ? []
        : [{ term: 'EU representative (GDPR Art. 27)', desc: [c.euRepresentative] }]),
    ],
  };

  return {
    id: 'privacy',
    title: 'Privacy Policy',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        id: 'ozet',
        heading: 'In short',
        blocks: [
          ul(
            'Important actions never happen without your approval.',
            'Data is encrypted in transit and at rest.',
            'Your data is never sold for advertising.',
            'Your email content is never used to train AI models.',
            'The full content of your emails is not stored; only summaries, short quotes and analysis results are kept for your retention period.',
            'You choose how long analysis results are kept: 30 days, 90 days, 1 year or until you delete them.',
            'Export your data, or delete your history or account, whenever you want.',
            md`You can delete your account and data at any time: in the app under Profile › Privacy & Security, or on the ${page('/data-deletion', 'Data Deletion page')}.`,
          ),
        ],
      },
      {
        id: 'veri-sorumlusu',
        heading: 'Data controller',
        blocks: [
          p(
            'This text is the information notice under Article 10 of the Turkish Personal Data Protection Law No. 6698 (KVKK) and the information under Article 13 of the EU General Data Protection Regulation (GDPR).',
          ),
          controller,
          p(
            'The obligation to register with the Turkish Data Controllers Registry (VERBİS) is assessed against the statutory thresholds; once registered, the registry details are published here.',
          ),
        ],
      },
      {
        id: 'kapsam',
        heading: 'Scope',
        blocks: [
          p(
            'This policy covers the Dijital Asistan iOS and Android apps, this website and our support channels. The internal administration panel is used only by authorised staff; end users do not enter data there.',
          ),
        ],
      },
      {
        id: 'islenen-veriler',
        heading: 'Data we process',
        blocks: [
          {
            type: 'table',
            caption: 'Categories of data processed',
            head: ['Category', 'Data processed', 'Source and time'],
            rows: [
              [
                ['Account'],
                [
                  'Name, email address, sign-in method (Apple, Google, Microsoft or an email code). You can use Apple’s hidden email address (…@privaterelay.appleid.com).',
                ],
                ['You; when you create the account'],
              ],
              [
                ['Connected email accounts'],
                [
                  'Header data (sender, recipients, subject, date, message IDs), a preview of up to 200 characters, AI summaries, key points, categories and short quotes of up to 300 characters verified against the source. ',
                  strong('Email bodies are not stored'),
                  '; when you open “Original email”, it is fetched live from your account, not saved and not written to logs. Attachments are read only when the “Attachments” data source is on, and only for analysis.',
                ],
                ['The Gmail or Outlook account you connect; during sync'],
              ],
              [
                ['Calendar'],
                ['Event title, time, attendees, location text, meeting link and organiser.'],
                ['The calendar you connect; during sync'],
              ],
              [
                ['Tasks'],
                ['Google Tasks or Microsoft To Do task title, due date and status.'],
                ['The task account you connect; during sync'],
              ],
              [
                ['Device calendar and reminders'],
                [
                  'Apple Calendar and Reminders on iPhone, the device calendar on Android: read only after you tap “Connect”, only while the app is open, and uploaded as a summary.',
                ],
                ['Your phone; while the app runs'],
              ],
              [
                ['Phone notifications (Android only, if you turn it on)'],
                [
                  'Notification content is processed on your device; only the extracted details (for example shipment status, amount, date) are saved to your account. Verification codes and security apps are always excluded. Notification text is ',
                  strong('never sent to the server'),
                  '.',
                ],
                ['Your Android phone; when you turn the feature on'],
              ],
              [
                ['Captures'],
                [
                  'Photos, screenshots, PDFs, files, links and text you share or upload. Files are deleted after analysis (see Retention).',
                ],
                ['You; when you share or upload'],
              ],
              [
                ['Voice'],
                [
                  'Voice commands are transcribed on the device. If your device can’t do this, Apple’s or Google’s speech recognition or our server-side speech recognition provider is used; recordings are not stored.',
                ],
                ['You; when you give a voice command'],
              ],
              [
                ['Assistant conversations'],
                ['The questions you ask and the answers, with source links.'],
                ['You; when you use the assistant'],
              ],
              [
                ['Preferences and rules'],
                [
                  'Briefing times, notification settings, priority rules, VIP people, learned preferences and your retention period.',
                ],
                ['You and your corrections in the app'],
              ],
              [
                ['Approved actions'],
                ['Proposed actions you approved or rejected (what, why, where, result).'],
                ['The app and your decisions'],
              ],
              [
                ['Notifications'],
                [
                  'Device notification token, the type and time of notifications sent; notification text is generated at the detail level you choose.',
                ],
                ['Your phone; when you allow notifications'],
              ],
              [
                ['Subscription'],
                [
                  'App user ID, subscription status, product, renewal and expiry dates. ',
                  strong('Your card details never reach us'),
                  '; Apple or Google takes the payment.',
                ],
                ['The App Store or Google Play; at purchase and renewals'],
              ],
              [
                ['Referral'],
                [
                  'Your invite code and invitation statuses; device and email signals turned into irreversible digests to prevent abuse.',
                ],
                ['You and the people you invite'],
              ],
              [
                ['Support'],
                [
                  'Email, name (optional), topic, message and language; when you write from the app, also the platform and app version.',
                ],
                ['You; when you send a support request'],
              ],
              [
                ['Product analytics'],
                [
                  'Content-free events (for example “briefing opened”); no email, conversation or personal details.',
                ],
                ['The app; during use'],
              ],
              [
                ['Error logs'],
                [
                  'Stack trace, device model, operating system and app version; personal data is scrubbed before sending.',
                ],
                ['The app; when an error occurs'],
              ],
              [
                ['This website'],
                [
                  'No cookies; only daily totals (see Cookies). Our hosting provider keeps short-lived access logs for security.',
                ],
                ['Your browser; when you visit'],
              ],
            ],
          },
          p(
            'We do not collect device location; the location text written in a calendar event is processed as part of the event.',
          ),
        ],
      },
      {
        id: 'amaclar',
        heading: 'Purposes and legal bases',
        blocks: [
          {
            type: 'table',
            caption: 'Purposes and legal bases',
            head: ['Purpose', 'Data', 'KVKK Art. 5', 'GDPR Art. 6'],
            rows: [
              [
                ['Briefings, classification, suggestions and the assistant'],
                ['Connected account data, preferences, assistant conversations'],
                ['Art. 5(2)(c) establishing or performing a contract'],
                ['6(1)(b)'],
              ],
              [
                ['Carrying out actions you approved (sending email, creating events and tasks)'],
                ['Approved action records, connected account access'],
                ['Art. 5(2)(c)'],
                ['6(1)(b)'],
              ],
              [
                ['Notifications'],
                ['Notification token, notification preferences'],
                ['Art. 5(2)(c)'],
                ['6(1)(b)'],
              ],
              [
                ['Subscription and referral management, preventing abuse'],
                ['Subscription and referral records, digested signals'],
                ['Art. 5(2)(c) and (f) legitimate interest'],
                ['6(1)(b) and 6(1)(f)'],
              ],
              [
                ['Security, debugging and system health'],
                ['Error logs, server logs, audit logs'],
                ['Art. 5(2)(f)'],
                ['6(1)(f)'],
              ],
              [
                ['Answering support requests'],
                ['Support request details'],
                ['Art. 5(2)(c) and (f)'],
                ['6(1)(b) and 6(1)(f)'],
              ],
              [
                ['Legal obligations and claims'],
                ['Relevant records'],
                ['Art. 5(2)(ç) and (e)'],
                ['6(1)(c) and 6(1)(f)'],
              ],
              [
                ['Improving the product with content-free analytics'],
                ['Content-free events, daily website totals'],
                ['Art. 5(2)(f)'],
                ['6(1)(f)'],
              ],
            ],
          },
          p(
            'We do not rely on explicit consent for the core service. Optional features (Android phone notification intelligence, “Learn from my interactions”) run only if you turn them on, and you can turn them off at any time.',
          ),
        ],
      },
      {
        id: 'yapay-zeka',
        heading: 'How AI processing works',
        blocks: [
          ul(
            'Deterministic filters and your rules run first. Only the content a feature needs is sent to AI providers.',
            'Content from emails, files and web pages is treated as untrusted data; instructions inside it are never followed.',
            'Output must be grounded in the source; an unverifiable date or amount is shown as “Not confirmed in the source.”',
            'Every AI inference has a “Where did this come from?” link.',
            'Verification codes, passwords, card and IBAN numbers and Turkish ID numbers are masked automatically before anything is sent to AI.',
            md`${strong('No automated decision with legal or similarly significant effect is made')} (KVKK Art. 11(1)(g), GDPR Art. 22). Every write needs your approval.`,
            'You can correct AI decisions; your corrections affect only your own preferences.',
            md`${strong('Your email content and other data are never used to train AI models.')} Neither we nor our AI providers train models on them.`,
            'For AI processing we work with Anthropic (primary), OpenAI (fallback and fallback speech recognition) and Voyage AI (semantic index); details are in Recipients and sub-processors.',
          ),
        ],
      },
      {
        id: 'google',
        heading: 'Google user data (Limited Use)',
        blocks: [
          {
            type: 'callout',
            id: 'google-limited-use',
            content: [
              'Dijital Asistan’s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.',
            ],
          },
          p(
            md`The policies: ${link(EXTERNAL_LINKS.googleUserDataPolicy, 'Google API Services User Data Policy')} and ${link(EXTERNAL_LINKS.googleWorkspaceUserDataPolicy, 'Google Workspace API User Data and Developer Policy')}.`,
          ),
          {
            type: 'table',
            caption: 'Google permissions we request',
            head: ['Permission', 'Why', 'When it is requested'],
            rows: [
              [['gmail.readonly'], ['To analyse your email'], ['When you connect Gmail']],
              [
                ['gmail.send'],
                ['Only to send a reply you approved'],
                ['At your first approved send'],
              ],
              [
                [
                  'calendar.events.readonly, calendar.calendarlist.readonly, calendar.settings.readonly',
                ],
                ['To read your calendar and apply your time zone correctly'],
                ['When you connect Google Calendar'],
              ],
              [
                ['calendar.events.owned'],
                ['Only to create or update events you approve'],
                ['At your first approved calendar change'],
              ],
              [['tasks.readonly'], ['To read your tasks'], ['When you connect Google Tasks']],
              [['tasks'], ['Only to create tasks you approve'], ['At your first approved task']],
            ],
          },
          ul(
            'Google data is used only to provide the user-facing features of the app.',
            'It is never used for advertising and never sold, and it is never used to develop, improve or train generalised or non-personalised AI or machine-learning models.',
            'It is transferred to third parties only to provide those features (the AI sub-processors acting on our instructions), for security, to comply with law, or in a merger or acquisition with prior notice.',
            'Humans do not read it, except with your affirmative agreement for specific messages (for example when you ask support to check an email), for security investigations, to comply with law, or in aggregated and anonymised form for internal operations.',
          ),
          { type: 'h3', text: 'Revoking access' },
          ul(
            'In the app: Profile › Connected Accounts › choose the account › Disconnect. We revoke Google access automatically.',
            md`At Google: ${link(EXTERNAL_LINKS.googleConnections, 'myaccount.google.com/connections')}.`,
          ),
        ],
      },
      {
        id: 'microsoft',
        heading: 'Microsoft account data',
        blocks: [
          ul(
            'When you connect: openid, profile, email, offline_access, User.Read and Mail.Read.',
            'When you connect calendar or tasks: Calendars.Read and Tasks.Read.',
            'Only when you approve your first write of that kind: Mail.Send, Calendars.ReadWrite and Tasks.ReadWrite.',
          ),
          p('The use rules written above for Google data apply to Microsoft data as well.'),
          p(
            md`Microsoft does not let apps revoke their own access. When you disconnect, we delete the stored access keys and stop synchronisation. To remove the permission at Microsoft too: ${link(EXTERNAL_LINKS.microsoftPersonalConsent, 'personal account')} or ${link(EXTERNAL_LINKS.microsoftWorkApps, 'work or school account')}.`,
          ),
        ],
      },
      {
        id: 'apple-ve-cihaz',
        heading: 'Sign in with Apple and device data',
        blocks: [
          ul(
            'Apple private relay email addresses are supported.',
            'When your account is deleted, we revoke the Sign in with Apple token at Apple.',
            'Apple Calendar (EventKit) and the Android device calendar are read only after you tap “Connect” and only while the app runs; freshness is shown as “last device sync”.',
            'Widget content stays on your device (App Group) and never shows more than the lock-screen detail you chose.',
            'iPhone has no notification-reading feature because iOS does not allow it.',
          ),
        ],
      },
      {
        id: 'alt-isleyiciler',
        heading: 'Recipients and sub-processors',
        blocks: [
          p(
            'We do not sell your data or share it for advertising. The service providers below process it only on our behalf and on our instructions.',
          ),
          { type: 'subprocessorTable' },
          p(
            'Locations follow the data regions we selected with each provider. Requests from authorities and courts are met only when legally required and only to the extent required. In a merger or acquisition we notify you in advance.',
          ),
        ],
      },
      {
        id: 'yurt-disi-aktarim',
        heading: 'International transfers',
        blocks: [
          p(
            'Our database is in the European Union (Frankfurt); AI processing runs at our sub-processors in the United States. Transfers from Türkiye follow KVKK Article 9 using the standard contracts announced by the Personal Data Protection Board, notified to the Authority within 5 business days of signature. Transfers from the EU/EEA rely on Standard Contractual Clauses or, where the provider is certified, an adequacy decision.',
          ),
        ],
      },
      {
        id: 'saklama',
        heading: 'Retention',
        blocks: [
          { type: 'retentionTable' },
          p(
            'Data whose retention period has passed is deleted by an automatic cleanup job, including the search index and stored files. You can change your retention period in the app under Profile › Privacy & Security › Data retention.',
          ),
        ],
      },
      {
        id: 'silme',
        heading: 'Export and deletion',
        blocks: [
          ul(
            'Export: Profile › Privacy & Security › Export my data. The file is prepared in the background; the download link is valid for 24 hours.',
            md`The scope of history deletion and account deletion is listed on the ${page('/data-deletion', 'Data Deletion page', 'neler-silinir')}.`,
            'When your account is deleted, Google and Apple access is revoked automatically; for Microsoft, use the links in the Microsoft section. Subscription records are deleted at RevenueCat; you need to cancel the store subscription separately.',
            md`Deletion usually completes within 24 hours; the legal maximum is 30 days. Copies in backups are deleted ${ctx.backupDays === undefined ? 'by the backup cycle' : `by the backup cycle within ${String(ctx.backupDays)} days`}.`,
            'We never say deletion is complete before it is; the result is confirmed by email.',
          ),
        ],
      },
      {
        id: 'guvenlik',
        heading: 'Security',
        blocks: [
          ul(
            'Data is protected with TLS in transit and encrypted at rest.',
            'Access keys to email, calendar and task accounts are additionally encrypted with AES-256-GCM and are never sent to the device.',
            'In the database, each user’s data is separated by row-level access rules.',
            'Staff access requires multi-factor authentication, role-based permissions and audit logs. Viewing personal data needs a reason and time-limited access, and every view is logged.',
            'Full email bodies are not stored.',
            'Every write needs approval.',
            'Logs are kept minimal and scrubbed of personal data.',
            'To prepare briefings and analysis, data is processed on our servers; so we do not offer encryption that only your device can decrypt.',
            md`If you found a security issue, email ${mail(c.securityEmail)}.`,
          ),
        ],
      },
      {
        id: 'bildirimler',
        heading: 'Notifications',
        blocks: [
          p(
            'The default notification detail level shows no sensitive content: “Title only”. Full detail is your choice. Quiet hours apply; notification text is generated on the server at the detail level you chose.',
          ),
        ],
      },
      {
        id: 'cerezler',
        heading: 'Cookies and this website',
        blocks: [
          ul(
            'This site uses no advertising, tracking or analytics cookies and stores no identifier that identifies you.',
            'Page views and button clicks are counted only as anonymous daily totals; no IP address or device identifier is stored.',
            'When your browser sends a “Global Privacy Control” or “Do Not Track” signal, nothing is counted.',
            'The data-deletion verification runs on our server; no session, token or cookie is created in your browser.',
            ...(ctx.turnstileEnabled
              ? [
                  'When bot protection is enabled, Cloudflare Turnstile runs only on the support and data-deletion forms, only to tell people from automated abuse; it is listed in Recipients and sub-processors.',
                ]
              : []),
          ),
        ],
      },
      {
        id: 'cocuklar',
        heading: 'Children',
        blocks: [
          p(
            md`The service is not intended for people under 18. If you believe an account belongs to a child, email ${mail(c.privacyEmail)}; we verify and delete the account.`,
          ),
        ],
      },
      {
        id: 'haklarin',
        heading: 'Your rights',
        blocks: [
          p('Under KVKK Article 11 you have the right to:'),
          ul(
            'learn whether your personal data is processed,',
            'request information about it if it is processed,',
            'learn the purpose of processing and whether data is used in line with that purpose,',
            'know the third parties in Türkiye or abroad to whom it is transferred,',
            'request correction if it is incomplete or inaccurate,',
            'request deletion or destruction under the conditions of KVKK Article 7,',
            'request that corrections and deletions be notified to the third parties it was transferred to,',
            'object to a result against you that arises exclusively from automated analysis,',
            'claim compensation for damage caused by unlawful processing.',
          ),
          p(
            'If the GDPR applies to you, you have the rights of access, rectification, erasure, restriction, data portability and objection (Articles 15–22) and the right to lodge a complaint with a supervisory authority.',
          ),
          { type: 'h3', text: 'How to apply' },
          ul(
            'In the app’s Privacy Center (Profile › Privacy & Security),',
            md`On the ${page('/data-deletion', 'Data Deletion page')} (account deletion),`,
            md`From your registered email address to ${mail(c.privacyEmail)},`,
            ...(c.address === undefined ? [] : [`In writing to ${c.address},`]),
            ...(c.kepAddress === undefined ? [] : [`By KEP to ${c.kepAddress}.`]),
          ),
          p(
            'We answer within 30 days free of charge; if the request involves an additional cost, the tariff set by the Board may apply. After applying to us, you can complain to the Personal Data Protection Board within the periods in KVKK Article 14.',
          ),
        ],
      },
      {
        id: 'degisiklikler',
        heading: 'Changes',
        blocks: [
          p(
            'Every version of this policy is published with its version number and effective date. We announce material changes in the app at least 15 days before they take effect.',
          ),
        ],
      },
      {
        id: 'iletisim',
        heading: 'Contact',
        blocks: [
          {
            type: 'dl',
            items: [
              { term: 'Privacy', desc: [mail(c.privacyEmail)] },
              { term: 'Support', desc: [mail(c.supportEmail)] },
              { term: 'Security', desc: [mail(c.securityEmail)] },
              ...(c.address === undefined ? [] : [{ term: 'Postal address', desc: [c.address] }]),
              ...(c.kepAddress === undefined ? [] : [{ term: 'KEP', desc: [c.kepAddress] }]),
            ],
          },
        ],
      },
    ],
  };
}
