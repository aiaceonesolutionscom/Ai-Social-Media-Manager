import { Navbar } from '../components/ui/Navbar';
import { Footer } from '../components/ui/Footer';
import { PageTransition } from '../components/layout/PageTransition';

interface Section {
  heading: string;
  body: string[];
}

function LegalLayout({ title, updated, sections }: { title: string; updated: string; sections: Section[] }) {
  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <PageTransition>
        <main className="px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-300">Legal</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">{title}</h1>
            <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>

            <div className="mt-8 space-y-8">
              {sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">{section.heading}</h2>
                  {section.body.map((paragraph, i) => (
                    <p key={i} className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </main>
      </PageTransition>
      <Footer />
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      updated="August 9, 2026"
      sections={[
        {
          heading: '1. Agreement',
          body: [
            'These Terms of Service ("Terms") govern your access to and use of the EchoPost platform, including its website, mobile experience, and API. By creating an account or using the service, you agree to be bound by these Terms.',
          ],
        },
        {
          heading: '2. Your account',
          body: [
            'You are responsible for maintaining the confidentiality of your credentials and for all activity that occurs under your account. You must provide accurate information and keep it up to date. You may not use the service if you are under the minimum age required by law in your jurisdiction.',
          ],
        },
        {
          heading: '3. Tokens and packages',
          body: [
            'EchoPost operates on a token-based system. Tokens are purchased through subscription packages or one-time top-ups. Token balances are displayed in your dashboard and are consumed when you generate, edit, or publish content through the service.',
            'Tokens do not expire except as described in the package you purchase. We may adjust token costs from time to time, and will communicate meaningful changes through the platform.',
          ],
        },
        {
          heading: '4. Acceptable use',
          body: [
            'You agree not to use the service to publish unlawful, harmful, harassing, or deceptive content, or to violate the terms of any third-party platform you connect. You are solely responsible for the content you generate and publish.',
          ],
        },
        {
          heading: '5. Payments and refunds',
          body: [
            'Payments are processed by our payment providers. Unless required by law, purchases are non-refundable once delivered. You can manage or cancel your plan from the packages page at any time.',
          ],
        },
        {
          heading: '6. Limitation of liability',
          body: [
            'The service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, EchoPost shall not be liable for indirect, incidental, or consequential damages arising from your use of the service.',
          ],
        },
        {
          heading: '7. Contact',
          body: [
            'Questions about these Terms? Reach out through the in-app Support page and we will get back to you within 24 hours.',
          ],
        },
      ]}
    />
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="August 9, 2026"
      sections={[
        {
          heading: '1. Information we collect',
          body: [
            'We collect the information you provide directly, such as your name, email address, and profile picture. We also collect usage data, including the voice notes you record, content you generate, and the platforms you connect.',
          ],
        },
        {
          heading: '2. How we use your information',
          body: [
            'We use your information to provide and improve the service: generating and publishing your posts, processing token purchases, providing support, and keeping the platform secure. We do not sell your personal information.',
          ],
        },
        {
          heading: '3. AI-generated content',
          body: [
            'Your voice notes and inputs are processed by AI models to create your posts. We do not use your content to train our models without your explicit consent.',
          ],
        },
        {
          heading: '4. Data sharing',
          body: [
            'We share data only with service providers who help us operate the platform (such as cloud hosting, payment processing, and AI providers), and only to the extent necessary to provide those services.',
          ],
        },
        {
          heading: '5. Your choices',
          body: [
            'You can update or delete your personal information from your profile and by contacting support. You can disconnect third-party platforms at any time from the settings page.',
          ],
        },
        {
          heading: '6. Contact',
          body: [
            'For any privacy questions, contact us through the in-app Support page.',
          ],
        },
      ]}
    />
  );
}

export function DataProcessingPage() {
  return (
    <LegalLayout
      title="Data Processing Agreement"
      updated="August 9, 2026"
      sections={[
        {
          heading: '1. Roles',
          body: [
            'Where EchoPost processes personal data on your behalf, we act as a data processor and you act as a data controller. This agreement sets out the terms of that processing.',
          ],
        },
        {
          heading: '2. Scope of processing',
          body: [
            'We process personal data you submit to the service — including content, account details, and connected-account information — solely to deliver the features you request, such as generating and publishing posts.',
          ],
        },
        {
          heading: '3. Sub-processors',
          body: [
            'We may engage sub-processors (for example AI providers, hosting, and payment infrastructure) to help deliver the service. We require them to meet the same data-protection standards we apply.',
          ],
        },
        {
          heading: '4. Retention',
          body: [
            'We retain personal data only for as long as needed to provide the service and comply with legal obligations. You can request deletion of your data by contacting support.',
          ],
        },
        {
          heading: '5. Security',
          body: [
            'We apply industry-standard technical and organizational measures to protect personal data, including encryption in transit and at rest, and access controls on our infrastructure.',
          ],
        },
        {
          heading: '6. Contact',
          body: [
            'Data processing questions can be sent through the in-app Support page.',
          ],
        },
      ]}
    />
  );
}
