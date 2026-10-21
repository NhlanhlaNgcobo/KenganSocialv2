import { Link } from 'react-router-dom';
import { COMPANY } from '../../content/legal';
import '../../pages/LandingPage.css';

/** Footer for every public page: who runs KenganSocial and the legal pages reviewers look for. */
export default function PublicFooter() {
    return (
        <footer className="lp-footer container">
            <span>
                © {new Date().getFullYear()} {COMPANY.product} · operated by {COMPANY.operator} · {COMPANY.address}
            </span>
            <nav aria-label="Footer">
                <Link to="/pricing">Pricing</Link>
                <Link to="/about">About</Link>
                <Link to="/help">Help</Link>
                <Link to="/privacy">Privacy</Link>
                <Link to="/terms">Terms</Link>
                <Link to="/data-deletion">Data deletion</Link>
                <a href={`mailto:${COMPANY.supportEmail}`}>Contact</a>
            </nav>
        </footer>
    );
}
