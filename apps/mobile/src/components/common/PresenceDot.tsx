import { View } from "react-native";

type PresenceDotProps = {
    online: boolean;
    className?: string;
};

export default function PresenceDot({ online, className = "" }: PresenceDotProps) {
    return (
        <View
            className={`h-3 w-3 rounded-full border-2 border-white dark:border-slate-950 ${online ? "bg-emerald-500" : "bg-slate-400"} ${className}`}
        />
    );
}