import React from "react";
import { BarChart3, TrendingUp, Users, Eye, Download, ChevronDown } from "lucide-react";

export default function AnalyticsView() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Insights</h1>
          <p className="text-gray-500 mt-1">Track how your documentation is performing.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center justify-between gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 min-w-[140px]">
            Last 30 Days <ChevronDown size={16} />
          </button>
          <button className="flex items-center justify-center gap-2 px-4 py-2 text-white rounded-md text-sm font-medium hover:bg-opacity-90" style={{ backgroundColor: "#0F62FE" }}>
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Total Views" value="45.2k" trend="+12.5%" isPositive={true} icon={<Eye className="text-blue-500" size={24} />} />
        <MetricCard title="Unique Visitors" value="12.4k" trend="+8.2%" isPositive={true} icon={<Users className="text-green-500" size={24} />} />
        <MetricCard title="Bounce Rate" value="42.3%" trend="-3.1%" isPositive={true} icon={<TrendingUp className="text-purple-500" size={24} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Placeholder for Main Chart */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Views Over Time</h2>
          <div className="h-64 flex items-end gap-2 justify-between">
            {/* Mock Chart Bars */}
            {Array.from({ length: 30 }).map((_, i) => (
              <div key={i} className="w-full bg-blue-100 rounded-t-sm relative group cursor-pointer" style={{ height: `${Math.max(20, Math.random() * 100)}%` }}>
                <div className="absolute inset-0 bg-[#0F62FE] opacity-0 group-hover:opacity-100 transition-opacity rounded-t-sm" />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4 text-xs text-gray-500">
            <span>Sep 1</span>
            <span>Sep 15</span>
            <span>Sep 30</span>
          </div>
        </div>

        {/* Top Documents */}
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Top Documents</h2>
          <div className="space-y-4">
            {[
              { name: "Getting Started Guide", views: "12,430" },
              { name: "Authentication API", views: "8,920" },
              { name: "Webhooks Reference", views: "6,215" },
              { name: "Error Codes", views: "4,890" },
              { name: "Rate Limits", views: "3,100" }
            ].map((doc, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-gray-50 flex items-center justify-center text-gray-500 font-medium text-sm">
                    {i + 1}
                  </div>
                  <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                </div>
                <p className="text-sm text-gray-600">{doc.views} views</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, isPositive, icon }: { title: string; value: string; trend: string; isPositive: boolean; icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-center text-sm">
        <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>{trend}</span>
        <span className="text-gray-500 ml-2">vs last period</span>
      </div>
    </div>
  );
}
