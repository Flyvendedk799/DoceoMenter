"use client";

import React, { useState } from "react";
import { LayoutDashboard, FolderKanban, BarChart3, Settings, Bell, Search, User, Plus, Upload, FileText, ArrowUpRight, Clock, Users, Activity, Filter, Grid, List, MoreVertical, Folder, TrendingUp, Eye, Download, ChevronDown, Key, Copy, Check } from "../icons";

export default function SettingsView() {
  const [activeTab, setActiveTab] = useState("profile");

  return (
    <div className="max-w-4xl mx-auto pb-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your account, team, and preferences.</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        {/* Settings Sidebar */}
        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-gray-200 p-4 space-y-1 bg-gray-50 flex flex-row md:flex-col overflow-x-auto">
          <TabButton active={activeTab === "profile"} onClick={() => setActiveTab("profile")} icon={<User size={18} />} label="Profile" />
          <TabButton active={activeTab === "team"} onClick={() => setActiveTab("team")} icon={<Users size={18} />} label="Team & Roles" />
          <TabButton active={activeTab === "api"} onClick={() => setActiveTab("api")} icon={<Key size={18} />} label="API Keys" />
        </div>

        {/* Settings Content */}
        <div className="flex-1 p-6 md:p-8">
          {activeTab === "profile" && <ProfileSettings />}
          {activeTab === "team" && <TeamSettings />}
          {activeTab === "api" && <ApiKeysSettings />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap w-full text-left ${
        active
          ? "bg-white text-[#0F62FE] shadow-sm border border-gray-200"
          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-transparent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProfileSettings() {
  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Profile Information</h2>
        <div className="flex items-center gap-6 mb-6">
          <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-2xl font-bold">
            JD
          </div>
          <div>
            <button className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 bg-white">
              Change Avatar
            </button>
          </div>
        </div>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input type="text" defaultValue="Jane Doe" className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0F62FE] focus:border-[#0F62FE]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <input type="email" defaultValue="jane@example.com" className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0F62FE] focus:border-[#0F62FE]" />
          </div>
          <button className="px-4 py-2 text-white rounded-md text-sm font-medium hover:bg-opacity-90 mt-4" style={{ backgroundColor: "#0F62FE" }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamSettings() {
  const team = [
    { name: "Jane Doe", email: "jane@example.com", role: "Owner" },
    { name: "John Smith", email: "john@example.com", role: "Admin" },
    { name: "Alex Johnson", email: "alex@example.com", role: "Editor" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Team & Roles</h2>
        <button className="flex items-center gap-2 px-3 py-1.5 text-white rounded-md text-sm font-medium hover:bg-opacity-90" style={{ backgroundColor: "#0F62FE" }}>
          <Plus size={16} /> Invite Member
        </button>
      </div>

      <div className="border border-gray-200 rounded-md overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Member</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {team.map((member, idx) => (
              <tr key={idx}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                      {member.name.charAt(0)}
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-500">{member.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {member.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button className="text-[#0F62FE] hover:text-blue-800">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApiKeysSettings() {
  const [copied, setCopied] = useState<number | null>(null);

  const keys = [
    { id: 1, name: "Production Key", key: "sk_prod_************************", created: "Oct 1, 2026", lastUsed: "2 hours ago" },
    { id: 2, name: "Development Key", key: "sk_dev_************************", created: "Oct 5, 2026", lastUsed: "Never" },
  ];

  const handleCopy = (id: number) => {
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">API Keys</h2>
          <p className="text-sm text-gray-500 mt-1">Manage keys used to authenticate API requests.</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-1.5 text-white rounded-md text-sm font-medium hover:bg-opacity-90" style={{ backgroundColor: "#0F62FE" }}>
          <Plus size={16} /> Generate Key
        </button>
      </div>

      <div className="space-y-4">
        {keys.map((key) => (
          <div key={key.id} className="border border-gray-200 rounded-md p-4 bg-white">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-medium text-gray-900">{key.name}</h3>
              <button className="text-sm text-red-600 hover:text-red-800">Revoke</button>
            </div>
            <div className="flex items-center mt-2 mb-4">
              <code className="flex-1 bg-gray-50 px-3 py-2 rounded-l-md border border-r-0 border-gray-200 text-sm font-mono text-gray-800">
                {key.key}
              </code>
              <button
                onClick={() => handleCopy(key.id)}
                className="px-3 py-2 border border-gray-200 rounded-r-md bg-gray-50 hover:bg-gray-100 text-gray-500 flex items-center justify-center h-full"
                title="Copy to clipboard"
              >
                {copied === key.id ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
              </button>
            </div>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>Created {key.created}</span>
              <span>•</span>
              <span>Last used {key.lastUsed}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
