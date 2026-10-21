/**
 * Company details used by the Terms, Privacy Policy, data deletion page and site footer.
 * ONE place to edit. Fields set to null are not known yet and MUST be filled in before applying
 * for platform API access: POPIA s18 requires the responsible party's name and address, Meta
 * Business Verification requires the CIPC-registered name, address and phone to match exactly.
 * scripts/check-legal.mjs lists any field still missing.
 */
export const COMPANY = {
    brand: 'KenganSocial',
    legalName: 'KenganSocial (Pty) Ltd',
    /** CIPC registration number, e.g. "2024/123456/07". */
    registrationNumber: null,
    /** Registered physical address (as on the CIPC certificate). */
    address: null,
    /** Business phone number (Meta Business Verification checks it). */
    phone: null,
    /** POPIA Information Officer (by default the head of the business). */
    informationOfficer: null,
    website: 'https://www.kengansocial.com',
    emails: {
        general: 'info@kengansocial.com',
        support: 'info@kengansocial.com',
        privacy: 'privacy@kengansocial.com',
        billing: 'billing@kengansocial.com',
    },
    /** URL of the published PAIA manual (PAIA s51); null until it is published. */
    paiaManualUrl: null,
    jurisdiction: 'South Africa',
    disputeForum: 'the Arbitration Foundation of Southern Africa (AFSA), Johannesburg',
};

/** Information Regulator (South Africa), from https://inforegulator.org.za/contact-us/ */
export const INFORMATION_REGULATOR = {
    name: 'Information Regulator (South Africa)',
    address: 'Woodmead North Office Park, 54 Maxwell Drive, Woodmead, Johannesburg, 2191',
    complaints: 'POPIAComplaints@inforegulator.org.za',
    enquiries: 'enquiries@inforegulator.org.za',
    phone: '010 023 5200',
    website: 'https://inforegulator.org.za',
};

/** Shown where a required company detail has not been filled in yet. */
export const MISSING = '[to be completed]';

export const LEGAL_UPDATED = '20 October 2026';
