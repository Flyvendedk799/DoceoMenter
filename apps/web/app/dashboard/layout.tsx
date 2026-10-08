import Link from "next/link";
import { LayoutDashboard, FolderKanban, BarChart3, Settings, Bell, Search, User } from "lucide-react";
import React from "react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex text-gray-900" style={{ backgroundColor: "#F4F4F4", fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex fixed h-full z-10">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <span className="text-xl font-bold" style={{ color: "#0F62FE" }}>Documenter</span>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          <NavLink href="/dashboard" icon={<LayoutDashboard size={20} />} label="Overview" />
          <NavLink href="/dashboard/projects" icon={<FolderKanban size={20} />} label="Projects" />
          <NavLink href="/dashboard/analytics" icon={<BarChart3 size={20} />} label="Analytics" />
          <NavLink href="/dashboard/settings" icon={<Settings size={20} />} label="Settings" />
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
              <User size={16} className="text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Jane Doe</p>
              <p className="text-xs text-gray-500">jane@example.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 relative min-h-screen">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="md:hidden font-bold" style={{ color: "#0F62FE" }}>Documenter</div>
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search..."
                className="pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#0F62FE] focus:border-[#0F62FE] w-64"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors">
              <Bell size={20} />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ backgroundColor: "#0F62FE" }}></span>
            </button>
            <button className="md:hidden p-2 text-gray-500 hover:text-gray-700">
              <LayoutDashboard size={20} />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>

      {/* Global overrides to isolate from the app's dark mode styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --dashboard-primary: #0F62FE;
          --dashboard-bg: #F4F4F4;
        }
        .text-primary { color: var(--dashboard-primary); }
        .bg-primary { background-color: var(--dashboard-primary); }
        .hover\\:bg-primary-hover:hover { background-color: #0353e9; }
        .ring-primary { --tw-ring-color: var(--dashboard-primary); }
        .border-primary { border-color: var(--dashboard-primary); }
      `}} />
    </div>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  // Hardcoding active state as simplistic for now since Next Router isn't available in server components cleanly without 'use client'
  // But we can add 'use client' to a child component if we want exact routing state. We will just use standard styles.
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100 hover:text-[#0F62FE] transition-colors font-medium text-sm"
    >
      {icon}
      {label}
    </Link>
  );
}
