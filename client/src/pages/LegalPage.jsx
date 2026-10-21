import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { COMPANY, LEGAL_DOCS, linkParts } from '../content/legal';
import './Legal.css';

/** Text with its URLs and email addresses linked. */
function Linked({ text }) {
    return linkParts(text).map((p, i) =>
        p.type === 'text' ? (
            <span key={i}>{p.value}</span>
        ) : (
            <a key={i} href={p.type === 'email' ? `mailto:${p.value}` : p.value} target={p.type === 'url' ? '_blank' : undefined} rel="noreferrer">
                {p.value}
            </a>
        )
    );
}

/**
 * Terms of Service, Privacy Policy and Data Deletion (/terms, /privacy, /data-deletion; /legal opens Terms).
 * Content lives in content/legal.js, which also builds the static copies reviewers fetch.
 */
export default function LegalPage({ docSlug = 'terms' }) {
    const navigate = useNavigate();
    const doc = LEGAL_DOCS.find((d) => d.slug === docSlug) || LEGAL_DOCS[0];
    // The highlighted section belongs to the document it was picked in, so it resets on a new one.
    const [picked, setPicked] = useState({ slug: null, id: null });
    const activeSection = picked.slug === doc.slug ? picked.id : null;
    const setActiveSection = (id) => setPicked({ slug: doc.slug, id });

    useEffect(() => {
        document.title = `${doc.title} | ${COMPANY.product}`;
        window.scrollTo(0, 0);
    }, [doc]);

    const scrollToSection = (id) => {
        const el = document.getElementById(`section-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveSection(id);
    };

    return (
        <div className="legal-root">
            <nav className="legal-nav">
                <Link to="/" className="legal-nav-logo">
                    <span className="legal-logo-k">Kengan</span>
                    <span className="legal-logo-s">Social</span>
                </Link>
                <div className="legal-nav-tabs">
                    {LEGAL_DOCS.map((d) => (
                        <Link key={d.slug} to={`/${d.slug}`} className={`legal-nav-tab ${d.slug === doc.slug ? 'active' : ''}`}>
                            {d.title}
                        </Link>
                    ))}
                </div>
                <button className="legal-nav-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
                    ← Back
                </button>
            </nav>

            <div className="legal-hero">
                <div className="legal-hero-label">Legal</div>
                <h1 className="legal-hero-title">{doc.title}</h1>
                <div className="legal-hero-sub">{doc.summary}</div>
                <div className="compliance-chips">
                    <span className="compliance-chip">POPIA 2013</span>
                    <span className="compliance-chip">ECTA 2002</span>
                    <span className="compliance-chip">CPA 2008</span>
                </div>
            </div>

            <div className="legal-layout">
                <aside className="legal-sidebar">
                    <div className="legal-sidebar-label" style={{ marginBottom: 4 }}>
                        Documents
                    </div>
                    {LEGAL_DOCS.map((d) => (
                        <Link key={d.slug} to={`/${d.slug}`} className={`legal-sidebar-link ${d.slug === doc.slug ? 'active' : ''}`}>
                            {d.title}
                        </Link>
                    ))}
                    <div className="legal-sidebar-divider" />
                    <div className="legal-sidebar-label">Sections</div>
                    {doc.sections.map((s) => (
                        <button key={s.id} className={`legal-sidebar-link ${activeSection === s.id ? 'active' : ''}`} onClick={() => scrollToSection(s.id)}>
                            {s.heading}
                        </button>
                    ))}
                </aside>

                <main className="legal-content">
                    <div className="legal-doc-header">
                        <div className="legal-doc-title">{doc.title}</div>
                        <div className="legal-doc-meta">
                            {COMPANY.operator} ({COMPANY.registration}) &nbsp;·&nbsp; Effective: <span>{doc.effectiveDate}</span> &nbsp;·&nbsp; Last updated:{' '}
                            <span>{doc.lastUpdated}</span>
                        </div>
                    </div>

                    {doc.sections.map((section, i) => (
                        <div key={section.id} id={`section-${section.id}`} className="legal-section">
                            <h2 className="legal-section-heading">
                                <span className="legal-section-num">{i + 1}</span>
                                {section.heading}
                            </h2>
                            <div className="legal-section-body">
                                <Linked text={section.content} />
                            </div>
                        </div>
                    ))}

                    {doc.slug === 'data-deletion' && (
                        <p className="legal-section-body">
                            <Link to="/data-deletion/status">Check a deletion request →</Link>
                        </p>
                    )}
                </main>
            </div>

            <div className="legal-contact-footer">
                <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>
                <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>
                <span>
                    {COMPANY.operator} · {COMPANY.registration}
                </span>
                <a href="https://inforegulator.org.za" target="_blank" rel="noreferrer">
                    Information Regulator
                </a>
            </div>
        </div>
    );
}
