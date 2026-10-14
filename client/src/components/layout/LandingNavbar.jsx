import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './LandingNavbar.css';
import { KenganLogo } from '../brand/KenganLogo';

const LINKS = [
    { to: '/pricing', label: 'Pricing' },
    { to: '/help', label: 'Help' },
    { to: '/about', label: 'About' },
];

export default function LandingNavbar() {
    const { user } = useAuth();

    return (
        <header className="landing-nav">
            <div className="landing-nav__container">
                <Link to="/" className="landing-nav__logo" aria-label="KenganSocial home">
                    <KenganLogo size={26} />
                </Link>

                <nav className="landing-nav__links" aria-label="Main">
                    {LINKS.map((l) => (
                        <NavLink key={l.to} to={l.to} className={({ isActive }) => `landing-nav__link ${isActive ? 'is-active' : ''}`}>
                            {l.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="landing-nav__actions">
                    {user ? (
                        <Link to="/dashboard" className="btn btn-primary btn-sm">Dashboard</Link>
                    ) : (
                        <>
                            <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
                            <Link to="/register" className="btn btn-primary btn-sm">Start free</Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}
