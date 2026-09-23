import { Button } from "../ui/button";

const ChatPlaceHolder = ({ onStartConversation }: { onStartConversation?: () => void }) => {
    return (
        <div className="flex h-full w-full items-center justify-center px-6">
            <div className="flex max-w-xs flex-col items-center text-center">
                <p className="text-sm font-medium text-foreground">Select a conversation</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Messages stay in the thread. Detected work shows up under the message that caused it.
                </p>
                <Button
                    size="sm"
                    className="mt-3 h-8"
                    data-testid="start-conversation"
                    onClick={onStartConversation}
                >
                    Start a conversation
                </Button>
            </div>
        </div>
    );
};
export default ChatPlaceHolder;