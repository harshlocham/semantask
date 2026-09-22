"use client";

import { Suspense } from "react";
import ChatWorkspace from "@/components/home/chat-workspace";

export default function AppHome() {
    return (
        <Suspense fallback={null}>
            <ChatWorkspace />
        </Suspense>
    );
}
