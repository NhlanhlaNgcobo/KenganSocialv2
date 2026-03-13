import './FeaturePage.css';

/**
 * Reusable placeholder for feature pages not yet implemented.
 */
export default function FeaturePage({ icon: Icon, title, description, comingSoon = true }) {
    return (
        <div className="feature-page animate-fade-in">
            <div className="feature-page__header">
                <h1>{title}</h1>
                {comingSoon && <span className="badge badge-brand">Coming Soon</span>}
            </div>

            <div className="feature-page__empty card">
                {Icon && (
                    <div className="feature-page__icon">
                        <Icon size={48} />
                    </div>
                )}
                <h2>{title}</h2>
                <p>{description || `The ${title.toLowerCase()} module is under construction. Check back soon!`}</p>
            </div>
        </div>
    );
}
