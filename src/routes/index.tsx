import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search, Sparkles, GraduationCap, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import heroPerson from "@/assets/hero-person.png";
import megaphone from "@/assets/megaphone.png";
import pencil from "@/assets/pencil.png";
import cyberHead from "@/assets/cyber-head.png";

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
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
      else setChecking(false);
    });
  }, [navigate]);
  if (checking) return <div className="min-h-screen bg-[#f5f5f5]" />;

  return (
    <div className="min-h-screen bg-[#f5f5f5]" style={{ fontFamily: "'Poppins', sans-serif" }}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col p-4 md:p-6">
        <nav className="flex items-center justify-between rounded-3xl bg-white px-6 py-4">
          <div className="flex items-center gap-2 text-xl font-bold">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
              <div className="h-2.5 w-2.5 rounded-full bg-black" />
            </div>
            <span>Moz<span className="text-[#ff5a6a]">ok</span></span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/auth" className="hidden text-sm font-medium text-gray-700 hover:text-black md:inline">Sign in</Link>
            <Link to="/auth" className="rounded-full bg-[#ff5a6a] px-5 py-2.5 text-sm font-semibold text-white/30 hover:opacity-95">
              Get started
            </Link>
          </div>
        </nav>

        <section className="mt-8 grid flex-1 grid-cols-1 items-center gap-8 rounded-3xl bg-white p-8 md:grid-cols-2 md:p-14">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#fde2e4] px-3 py-1 text-xs font-semibold text-[#c9576a]">
              <Sparkles className="h-3 w-3" /> Learn something new today
            </div>
            <h1 className="mt-4 text-4xl font-bold leading-tight md:text-6xl">
              What do you <span className="text-[#ff5a6a]">wanna learn?</span>
            </h1>
            <p className="mt-4 max-w-md text-gray-600">
              Bite-sized courses, real progress tracking, and a growing library of skills — from languages to code to design.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/auth" className="inline-flex items-center gap-2 rounded-full bg-[#ff5a6a] px-6 py-3 text-sm font-semibold text-white/30">
                Start learning <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/auth" className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-6 py-3 text-sm font-semibold hover:bg-gray-50">
                <Search className="h-4 w-4" /> Browse courses
              </Link>
            </div>
            <div className="mt-10 flex gap-8 text-sm">
              <div className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-[#ff5a6a]" /><span><b>200+</b> courses</span></div>
              <div className="flex items-center gap-2"><Users className="h-5 w-5 text-[#4aa9c9]" /><span><b>50K+</b> learners</span></div>
            </div>
          </div>
          <div className="relative">
            <img src={heroPerson} alt="Learner" className="mx-auto w-full max-w-md" />
            <img src={megaphone} alt="" className="absolute -left-4 top-4 h-24 w-24 rotate-[-8deg]" />
            <img src={pencil} alt="" className="absolute -right-2 bottom-8 h-24 w-28 rotate-[6deg]" />
            <img src={cyberHead} alt="" className="absolute -bottom-4 left-1/3 h-24 w-24" />
          </div>
        </section>
      </div>
    </div>
  );
}
