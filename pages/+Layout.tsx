import "../src/styles/globals.css";
import Header from "../src/components/layout/Header";
import Footer from "../src/components/layout/Footer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex flex-col bg-surface-900">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </QueryClientProvider>
  );
}
