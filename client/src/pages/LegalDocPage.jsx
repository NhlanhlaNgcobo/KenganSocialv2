/**
 * Public legal pages: /terms, /privacy and /data-deletion, rendered from src/legal/legal-content.js
 * (the same text scripts/build-legal.mjs publishes as static HTML). Reachable without signing in.
 */
import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LandingNavbar from '../components/layout/LandingNavbar';
import { POLICIES } from '../legal/legal-content';
import { COMPANY } from '../legal/company';
import './LandingPage.css';
import './LegalDoc.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/** Inline markup: [label](url) links and **bold**. Internal links use the router. */
function Inline({ text }) {
    const parts = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) parts.push(text.slice(last, m.index));
        if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>);
        else if (m[2].startsWith('/')) parts.push(<Link key={m.index} to={m[2]}>{m[1]}</Link>);
        else parts.push(<a key={m.index} href={m[2]} target={m[2].startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer">{m[1]}</a>);
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
}

function Block({ block }) {
    if (block.p) return <p><Inline text={block.p} /></p>;
    if (block.ul) return <ul>{block.ul.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>;
    if (block.table) {
        return (
            <div className="ld-table-wrap">
                <table className="ld-table">
                    <thead><tr>{block.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{block.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}><Inline text={cell} /></td>)}</tr>)}</tbody>
                </table>
            </div>
        );
    }
    return null;
}

/** Status of a deletion request by confirmation code (the URL Meta's data deletion callback returns). */
function DeletionStatus() {
    const [params] = useSearchParams();
    const [code, setCode] = useState(params.get('code') || params.get('id') || '');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const lookup = async (value) => {
        if (!value.trim()) return;
        setBusy(true);
        setResult(null);
        try {
            const res = await fetch(`${API_URL}/privacy/deletion-status/${encodeURIComponent(value.trim())}`);
            const body = await res.json().catch(() => ({}));
            setResult(res.ok ? body : { error: body.error || 'That code could not be checked.' });
        } catch {
            setResult({ error: 'The status service is unavailable. Try again later.' });
        } finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        if (code) lookup(code);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <section className="ld-section ld-status" id="status">
            <h2>Check a deletion request</h2>
            <p>Enter the confirmation code you received (from Facebook or after deleting your account).</p>
            <form
                className="ld-status__form"
                onSubmit={(e) => {
                    e.preventDefault();
                    lookup(code);
                }}
            >
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Confirmation code" aria-label="Confirmation code" />
                <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check status'}</button>
            </form>
            {result ? (
                result.error ? (
                    <p className="ld-status__result is-error" role="status">{result.error}</p>
                ) : (
                    <p className="ld-status__result" role="status">
                        Request <strong>{result.code}</strong>: <strong>{result.status === 'completed' ? 'Deletion completed' : result.status}</strong>
                        {result.completedAt ? ` on ${new Date(result.completedAt).toLocaleString()}` : ''}.{result.reason ? ` ${result.reason}` : ''}
                    </p>
                )
            ) : null}
        </section>
    );
}

export default function LegalDocPage({ doc }) {
    const policy = POLICIES[doc];
    useEffect(() => {
        document.title = `${policy.title} | ${COMPANY.brand}`;
        window.scrollTo(0, 0);
    }, [policy]);

    return (
        <div className="landing-page bg-primary ld-root">
            <div className="bg-grid absolute-inset" />
            <LandingNavbar />
            <main className="ld-main">
                <nav className="ld-tabs" aria-label="Legal documents">
                    <Link className={doc === 'terms' ? 'is-active' : ''} to="/terms">Terms of Service</Link>
                    <Link className={doc === 'privacy' ? 'is-active' : ''} to="/privacy">Privacy Policy</Link>
                    <Link className={doc === 'data-deletion' ? 'is-active' : ''} to="/data-deletion">Data Deletion</Link>
                </nav>
                <article className="ld-doc">
                    <h1>{policy.title}</h1>
                    <p className="ld-updated">Last updated: {policy.updated}</p>
                    <p className="ld-intro"><Inline text={policy.intro} /></p>
                    {policy.sections.length > 4 ? (
                        <ol className="ld-toc">
                            {policy.sections.map((s) => (
                                <li key={s.id}><a href={`#${s.id}`}>{s.heading.replace(/^\d+\.\s*/, '')}</a></li>
                            ))}
                        </ol>
                    ) : null}
                    {policy.sections.map((s) => (
                        <section key={s.id} id={s.id} className="ld-section">
                            <h2>{s.heading}</h2>
                            {s.blocks.map((b, i) => <Fragment key={i}><Block block={b} /></Fragment>)}
                        </section>
                    ))}
                    {doc === 'data-deletion' ? <DeletionStatus /> : null}
                </article>
            </main>
        </div>
    );
}
