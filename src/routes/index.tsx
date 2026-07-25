import { createFileRoute } from "@tanstack/react-router";
import { Bell, Menu, Search, MoreHorizontal, Heart, ArrowRight, LayoutGrid, List, ChevronLeft, ChevronRight, Palette, Code2, FileCode } from "lucide-react";
import heroPerson from "@/assets/hero-person.png";
import megaphone from "@/assets/megaphone.png";
import pencil from "@/assets/pencil.png";
import cyberHead from "@/assets/cyber-head.png";
import avatarUser from "@/assets/avatar-user.jpg";
import avatarGeorge from "@/assets/avatar-george.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mozok — What do you wanna learn?" },
      { name: "description", content: "Mozok learning platform: browse courses, track progress, and grow new skills." },
      { property: "og:title", content: "Mozok — What do you wanna learn?" },
      { property: "og:description", content: "Browse courses, track progress, and grow new skills on Mozok." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-[#f5f5f5] p-4 md:p-6" style={{ fontFamily: "'Poppins', sans-serif" }}>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 lg:flex-row">
        {/* MAIN */}
        <main className="flex-1 rounded-3xl bg-white p-6 md:p-10">
          {/* Nav */}
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xl font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
                <div className="h-2.5 w-2.5 rounded-full bg-black" />
              </div>
              <span>Moz<span className="text-[#ff5a6a]">ok</span></span>
            </div>
            <div className="flex items-center gap-5 text-gray-700">
              <Bell className="h-5 w-5" />
              <Menu className="h-5 w-5" />
            </div>
          </nav>

          {/* Hero */}
          <section className="mt-8 grid grid-cols-1 items-center gap-6 md:grid-cols-[240px_1fr]">
            <img src={heroPerson} alt="Learner illustration" width={240} height={240} className="w-48 md:w-full" />
            <div>
              <p className="text-2xl text-gray-700">Hi George,</p>
              <h1 className="mt-1 text-4xl font-bold leading-tight md:text-5xl">What do you wanna learn?</h1>
              <div className="mt-6 flex items-center rounded-full bg-white p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.15)] ring-1 ring-gray-100">
                <input
                  type="text"
                  placeholder="Search ..."
                  className="flex-1 bg-transparent px-5 py-2 text-sm outline-none placeholder:text-gray-400"
                />
                <button className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ff5a6a] text-white shadow-lg shadow-[#ff5a6a]/30">
                  <Search className="h-5 w-5" />
                </button>
              </div>
            </div>
          </section>

          {/* Filter row */}
          <div className="mt-10 flex items-center justify-between border-b border-gray-100 pb-2">
            <div className="flex gap-6 text-sm">
              <button className="relative pb-2 font-semibold">
                All
                <span className="absolute inset-x-0 -bottom-[1px] mx-auto h-0.5 w-6 rounded-full bg-[#ff5a6a]" />
              </button>
              <button className="pb-2 text-gray-500">New</button>
              <button className="pb-2 text-gray-500">Popular</button>
            </div>
            <div className="flex items-center gap-3 text-gray-500">
              <List className="h-5 w-5" />
              <LayoutGrid className="h-5 w-5" />
            </div>
          </div>

          {/* Course cards */}
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Big card: Easy English */}
            <div className="row-span-2 rounded-3xl bg-white p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.15)] ring-1 ring-gray-100">
              <h3 className="text-3xl font-bold">Easy English</h3>
              <p className="mt-1 text-sm text-gray-500">Language cources</p>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={avatarUser} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover" loading="lazy" />
                  <div>
                    <div className="text-2xl font-bold text-[#4aa9c9]">4,5</div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Heart className="h-3 w-3 fill-[#ff5a6a] text-[#ff5a6a]" /> 2431
                    </div>
                  </div>
                </div>
                <img src={megaphone} alt="" width={160} height={160} className="h-32 w-32 object-contain" loading="lazy" />
              </div>
              <div className="mt-8 flex items-center justify-between">
                <div className="rounded-full bg-[#e6f4f8] px-4 py-2 text-sm font-semibold text-gray-800">$35.00</div>
                <div className="text-sm text-gray-500">1 Hour</div>
                <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ff5a6a] text-white">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Illustrator */}
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.15)] ring-1 ring-gray-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold">Illustrator "Professional"</h3>
                  <p className="mt-1 text-sm text-gray-500">New work skills</p>
                </div>
                <img src={pencil} alt="" width={120} height={90} className="h-20 w-28 object-contain" loading="lazy" />
              </div>
              <div className="mt-6 flex items-center justify-between">
                <div className="rounded-full bg-[#e6f4f8] px-3 py-1.5 text-xs font-semibold">$50.00</div>
                <div className="text-xs text-gray-500">1 lesson</div>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ff5a6a] text-white">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Cybersecurity */}
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.15)] ring-1 ring-gray-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold">Cybersecurity</h3>
                  <p className="mt-1 text-sm text-gray-500">Most viewed</p>
                </div>
                <img src={cyberHead} alt="" width={120} height={90} className="h-20 w-28 object-contain" loading="lazy" />
              </div>
              <div className="mt-6 flex items-center justify-between">
                <div className="rounded-full bg-[#fde2e4] px-3 py-1.5 text-xs font-semibold">$1000.00</div>
                <div className="text-xs text-gray-500">2 months</div>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ff5a6a] text-white">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* SIDEBAR */}
        <aside className="w-full space-y-6 lg:w-[360px]">
          {/* Profile */}
          <div className="rounded-3xl bg-[#111114] p-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={avatarGeorge} alt="George Stone" width={56} height={56} className="h-14 w-14 rounded-full object-cover" />
                <div>
                  <div className="text-lg font-semibold">George Stone</div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="h-2 w-2 rounded-full bg-[#ff5a6a]" /> Online
                  </div>
                </div>
              </div>
              <MoreHorizontal className="h-5 w-5 text-gray-400" />
            </div>
            <div className="mt-6 grid grid-cols-3 text-center">
              <div>
                <div className="text-xs text-gray-400">Score</div>
                <div className="mt-1 text-xl font-bold">9.7</div>
              </div>
              <div className="border-x border-white/10">
                <div className="text-xs text-gray-400">Earned coins</div>
                <div className="mt-1 text-xl font-bold">10.5K</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Followers</div>
                <div className="mt-1 text-xl font-bold">100K</div>
              </div>
            </div>
          </div>

          {/* Courses list */}
          <div className="rounded-3xl bg-white p-6">
            <div className="flex gap-6 border-b border-gray-100 pb-3 text-sm">
              <button className="relative pb-1 font-semibold">
                Subscribed
                <span className="absolute inset-x-0 -bottom-[13px] mx-auto h-0.5 w-16 rounded-full bg-[#ff5a6a]" />
              </button>
              <button className="text-gray-400">Upcoming</button>
              <button className="text-gray-400">Passed</button>
            </div>

            <ul className="mt-4 space-y-2">
              {[
                { icon: "A", label: "Basic English", sub: "Language cources", val: 50, active: false, tint: "bg-[#e6f4f8] text-[#4aa9c9]" },
                { icon: <Palette className="h-4 w-4" />, label: "Illustrator", sub: "New work skills", val: 64, active: true, tint: "bg-black text-white" },
                { icon: "JS", label: "JavaScript", sub: "Language programming", val: 75, active: false, tint: "bg-[#fff4d6] text-[#c98a1a]" },
                { icon: <FileCode className="h-4 w-4" />, label: "HTML", sub: "Language programming", val: 80, active: false, tint: "bg-[#fde2e4] text-[#c9576a]" },
              ].map((c, i) => (
                <li key={i} className={`flex items-center justify-between rounded-2xl p-3 ${c.active ? "bg-[#f5f5f5]" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${c.tint}`}>
                      {c.icon}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{c.label}</div>
                      <div className="text-xs text-gray-400">{c.sub}</div>
                    </div>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-xs font-semibold text-gray-500">
                    {c.val}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Calendar */}
          <div className="rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold">Calendar</h4>
              <div className="flex items-center gap-3 text-gray-400">
                <ChevronLeft className="h-4 w-4" />
                <ChevronRight className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-center">
              {[
                { d: 13, wd: "Mon", active: true, dot: "bg-[#ff5a6a]" },
                { d: 14, wd: "Tue", dot: "bg-[#ff5a6a]" },
                { d: 15, wd: "Wed", dot: "bg-[#4aa9c9]" },
                { d: 16, wd: "Thu", dot: "bg-[#c98a1a]" },
                { d: 17, wd: "Fri", dot: "bg-[#ff5a6a]" },
              ].map((day) => (
                <div
                  key={day.d}
                  className={`rounded-2xl py-3 ${day.active ? "shadow-[0_10px_25px_-10px_rgba(0,0,0,0.15)] ring-1 ring-gray-100" : ""}`}
                >
                  <div className={`mx-auto mb-2 h-1.5 w-1.5 rounded-full ${day.dot}`} />
                  <div className={`text-lg font-bold ${day.active ? "" : "text-gray-700"}`}>{day.d}</div>
                  <div className="text-[10px] text-gray-400">{day.wd}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
