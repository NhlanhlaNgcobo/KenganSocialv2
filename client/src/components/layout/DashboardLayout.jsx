import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import './DashboardLayout.css';

export default function DashboardLayout() {
    return (
        <div className="dashboard">
            <Sidebar />
            <main className="dashboard__main">
                <div className="dashboard__content animate-fade-in">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
