// Preserved from the supplied BA prototype; the source copy is not generated from token data.
const SYNTHETIC_TOKEN_BODY = [
    'Certain stock tokens are designed to provide investors with economic exposure to publicly traded securities. Depending on how they are structured, these tokens may represent a contractual or debt claim on a special purpose vehicle (SPV) or another issuing entity that holds the underlying security, rather than direct ownership of the security itself.',
    'As a result, holders of these tokens may not be recorded as the beneficial owners of the underlying securities and may not receive the full set of shareholder rights associated with direct ownership. The specific rights and features of a token are determined by its issuer.',
    "To support corporate governance participation, participating token issuers have partnered with Broadridge to enable eligible token holders to submit their voting preferences. These preferences are then transmitted to the relevant intermediary for consideration in the voting process in accordance with the issuer's governance framework.",
];
/*
 * Kept from the questions this section replaced: it is the page's only
 * regulator citation, and it supports the claims the copy above makes about
 * how these products are structured.
 *
 * Labelled by the document's real title. The page is the SEC staff's
 * "Statement on Tokenized Securities" (Jan. 28, 2026); it does not define the
 * phrase "synthetic tokens", it defines "synthetic tokenized securities" as
 * one of two third-party models of tokenized securities. Announcing it as a
 * definition of synthetic tokens would tell the reader they will find
 * something that is not there.
 */
const SYNTHETIC_TOKEN_LINK = {
    href: 'https://www.sec.gov/newsroom/speeches-statements/corp-fin-statement-tokenized-securities-012826-statement-tokenized-securities',
    label: 'SEC Statement on Tokenized Securities (January 28, 2026)',
};
const WALLET_AUTHENTICATION_TOPICS = [
    {
        id: 'wallet-authentication',
        question: 'Why am I being asked to authenticate my wallet?',
        answer: [
            'Wallet authentication is used to help confirm that you control the wallet associated with your eligible holdings.',
            'This step is intended only to verify wallet ownership for participation in the proxy voting process. It is not used to take custody of assets, move funds, or access your wallet contents.',
            'Authentication helps create a more secure and reliable connection between an eligible shareholder and the voting experience.',
        ],
    },
    {
        id: 'signing-with-a-private-key',
        question: 'What does signing with a private key mean?',
        answer: [
            'In this experience, signing is used as a secure way to prove that you control your wallet.',
            'When you sign, your wallet is creating a cryptographic confirmation. This helps verify your identity or consent without revealing your private key.',
            'Your private key is not shared, exposed, or transmitted through this process. The signing action is only a verification step.',
        ],
    },
    {
        id: 'private-key-sharing',
        question: 'Is my private key or personal information being shared?',
        answer: [
            'No. Your private key remains private.',
            'Signing is used only to confirm wallet ownership or authorize a step in the experience. The private key itself is not visible to the platform, not stored by the application, and not shared with any third party.',
        ],
    },
    {
        id: 'why-this-matters',
        question: 'Why does this matter to shareholders?',
        answer: [
            'As digital infrastructure continues to evolve, shareholders may begin to see new tools that make it easier and more secure to participate in corporate voting.',
            'Using a digital wallet can help confirm ownership quickly and securely, allowing investors to access their proxy ballot and submit their vote without relying on traditional processes and workflows. Wallet authentication helps ensure that only eligible shareholders participate while maintaining privacy and control over personal credentials.',
        ],
    },
];
export const EDUCATION_SECTIONS = [
    /*
     * Deliberately untitled: this copy opens the page, so it reads as a
     * continuation of the intro above it, not as a labelled subsection.
     */
    {
        id: 'synthetic-tokens',
        kind: 'prose',
        body: SYNTHETIC_TOKEN_BODY,
        link: SYNTHETIC_TOKEN_LINK,
    },
    {
        id: 'wallet-authentication-section',
        title: 'Wallet Authentication',
        kind: 'faq',
        topics: WALLET_AUTHENTICATION_TOPICS,
    },
];
export const EDUCATION_INTRO = 'This page provides helpful information about what synthetic tokens are, how they differ from traditional securities, and how wallet authentication helps securely verify eligibility and support participation for eligible synthetic token holders.';
/**
 * Same destination as the "What is a proxy vote?" popover already links to, so
 * the two education entry points cannot drift apart.
 */
export const SHAREHOLDER_EDUCATION_URL = 'https://www.shareholdereducation.com';
