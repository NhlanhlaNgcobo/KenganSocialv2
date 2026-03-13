import LandingNavbar from '../components/layout/LandingNavbar';
import { ArrowRight, Play } from 'lucide-react';
import './LandingPage.css';

export default function LandingPage() {
    const mockupUrl = 'file:///C:/Users/NhlanhlaNgcobo/.gemini/antigravity/brain/14dbfdab-c226-4f03-9cb9-565a079a0b2a/kengan_phone_mockups_1771634785813.png';

    return (
        <div className="landing-page bg-primary">
            <div className="bg-grid absolute-inset" />
            <div className="bg-glow absolute-inset" />

            <LandingNavbar />

            <main className="landing-hero">
                <div className="landing-hero__content container">
                    <div className="badge badge-brand animate-fade-in">
                        <span className="badge-dot" /> A.I Driven Social Management
                    </div>

                    <h1 className="landing-hero__title animate-slide-in">
                        Elevate Your Socials <br />
                        with <span className="text-gradient">AI-Powered</span> Magic
                    </h1>

                    <p className="landing-hero__subtitle animate-fade-in delay-1">
                        Centralize your content creation, scheduling, and analytics. <br />
                        Our AI automates the grunt work so you can focus on creativity.
                    </p>

                    <div className="landing-hero__actions animate-fade-in delay-2">
                        <button className="btn btn-primary btn-lg">
                            Start Free Trial <ArrowRight size={18} />
                        </button>
                        <button className="btn btn-secondary btn-lg">
                            <Play size={18} fill="currentColor" /> Watch Demo
                        </button>
                    </div>
                </div>

                <div className="landing-hero__mockup container animate-fade-in delay-3">
                    <img src={mockupUrl} alt="KenganSocial App Mockups" className="hero-img" />
                </div>
            </main>

            <div className="landing-streaks">
                <div className="streak streak-1" />
                <div className="streak streak-2" />
            </div>
        </div>
    );
}
