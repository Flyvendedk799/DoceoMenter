import React from "react";
import { Plus, Upload, FileText, ArrowUpRight, Clock, Users, Activity } from "lucide-react";
import Link from "next/link";

export default function DashboardOverview() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, Jane</h1>
          <p className="text-gray-500 mt-1">Here's what's happening with your documentation projects today.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex-1 sm:flex-none">
            <Upload size={16} />
            Import
          </button>
          <button className="flex items-center justify-center gap-2 px-4 py-2 text-white rounded-md text-sm font-medium hover:bg-opacity-90 flex-1 sm:flex-none" style={{ backgroundColor: "#0F62FE" }}>
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {/* Analytics Snapshot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Projects" value="24" icon={<FileText size={20} className="text-blue-500" />} trend="+12% this month" />
        <StatCard title="Active Team Members" value="8" icon={<Users size={20} className="text-green-500" />} trend="+2 this week" />
        <StatCard title="Total Documents" value="142" icon={<FileText size={20} className="text-purple-500" />} trend="+24% this month" />
        <StatCard title="API Requests" value="1.2k" icon={<Activity size={20} className="text-orange-500" />} trend="+5% today" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Projects */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Recent Projects</h2>
            <Link href="/dashboard/projects" className="text-sm font-medium text-[#0F62FE] hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-md bg-blue-50 flex items-center justify-center text-[#0F62FE]">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">Payment Gateway Integration</h3>
                    <p className="text-sm text-gray-500 flex items-center gap-1">
                      <Clock size={14} /> Updated 2 hours ago
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Active
                  </span>
                  <button className="text-gray-400 hover:text-gray-600">
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          </div>
          <div className="p-6">
            <div className="relative border-l border-gray-200 ml-3 space-y-6">
              {[
                { title: "Documentation updated", user: "Jane Doe", time: "1 hour ago", type: "update" },
                { title: "New project created", user: "John Smith", time: "3 hours ago", type: "create" },
                { title: "API key generated", user: "Jane Doe", time: "Yesterday", type: "settings" },
                { title: "Team member added", user: "Admin", time: "2 days ago", type: "team" }
              ].map((activity, i) => (
                <div key={i} className="relative pl-6">
                  <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#0F62FE]"></span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{activity.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{activity.user} • {activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend }: { title: string; value: string; icon: React.ReactNode; trend: string }) {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
        </div>
        <div className="p-2 bg-gray-50 rounded-md">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-center text-sm text-green-600">
        <span>{trend}</span>
      </div>
    </div>
  );
}
