import { useState } from "react";
import { useAppStore } from "./state/store";
import { I18nProvider } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { SetupGuide } from "./components/SetupGuide";
import { TokenGate } from "./components/TokenGate";
import { TodoBar } from "./components/TodoBar";
import { TopBar } from "./components/TopBar";
import { GoalBar } from "./components/GoalBar";
import { ChatList } from "./components/ChatList";
import { Composer } from "./components/Composer";
import { ExtUiDialogs, Toasts } from "./components/Overlays";

function Shell() {
  const health = useAppStore((s) => s.health);
  const authRequired = useAppStore((s) => s.authRequired);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  // Blocking token gate until the bridge accepts the access token.
  if (authRequired) {
    return <TokenGate />;
  }

  // Blocking install guide until the bridge finds the omp binary.
  if (health && !health.ompResolved) {
    return <SetupGuide />;
  }

  return (
    <div className="flex h-full overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <GoalBar />
        <TodoBar />
        <ChatList />
        <Composer />
      </main>
      <ExtUiDialogs />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
