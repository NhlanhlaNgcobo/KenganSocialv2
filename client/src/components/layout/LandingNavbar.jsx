import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import './LandingNavbar.css';

export default function LandingNavbar() {
    return (
        <nav className="landing-nav glass">
            <div className="landing-nav__container">
                <div className="landing-nav__logo">
                    <div className="landing-nav__logo-icon">K</div>
                    <span>KenganSocial</span>
                </div>

                <div className="landing-nav__links">
                    <Link to="/" className="landing-nav__link">Home</Link>
                    <Link to="/about" className="landing-nav__link">About</Link>
                    <Link to="/help" className="landing-nav__link">Help Center</Link>
                    <Link to="/pricing" className="landing-nav__link">Pricing</Link>
                    <Link to="/privacy" className="landing-nav__link">Privacy</Link>
                </div>

                <div className="landing-nav__actions">
                    <Link to="/login" className="btn btn-primary">Get Started</Link>
                </div>
            </div>
        </nav>
    );
}
