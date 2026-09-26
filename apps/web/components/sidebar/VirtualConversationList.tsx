"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Conversation from "./Conversation";
import useChatStore from "@/store/chat-store";

const VirtualConversationList = () => {
    const conversations = useChatStore((s) => s.conversations);

    const parentRef = useRef<HTMLDivElement>(null);

    const rowVirtualizer = useVirtualizer({
        count: conversations.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72,
        overscan: 5,
    });

    return (
        <div
            ref={parentRef}
            className="custom-scrollbar h-full overflow-y-auto"
        >
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                }}
            >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const conversation = conversations[virtualRow.index];

                    return (
                        <div
                            key={conversation._id}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <Conversation conversation={conversation} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default VirtualConversationList;