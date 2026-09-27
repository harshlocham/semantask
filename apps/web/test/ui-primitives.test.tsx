/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

describe("ui primitives", () => {
    it("renders badge tones as tinted labels", () => {
        render(<Badge tone="warning">Needs review</Badge>);
        const badge = screen.getByText("Needs review");
        expect(badge).toHaveAttribute("data-slot", "badge");
        expect(badge.className).toContain("bg-warning/10");
        expect(badge.className).toContain("text-warning");
        expect(badge.className).not.toContain("bg-warning ");
    });

    it("moves tabs with the arrow keys and shows the matching panel", () => {
        function Harness() {
            const [value, setValue] = useState("one");
            return (
                <Tabs value={value} onValueChange={setValue}>
                    <TabsList>
                        <TabsTrigger value="one">One</TabsTrigger>
                        <TabsTrigger value="two">Two</TabsTrigger>
                    </TabsList>
                    <TabsContent value="one">Panel one</TabsContent>
                    <TabsContent value="two">Panel two</TabsContent>
                </Tabs>
            );
        }

        render(<Harness />);
        expect(screen.getByText("Panel one")).toBeInTheDocument();
        expect(screen.queryByText("Panel two")).toBeNull();

        const first = screen.getByRole("tab", { name: "One" });
        first.focus();
        fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

        expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByText("Panel two")).toBeInTheDocument();
        expect(screen.queryByText("Panel one")).toBeNull();
    });

    it("forwards select value changes", () => {
        const onChange = jest.fn();
        render(
            <Select aria-label="Priority" defaultValue="medium" onChange={onChange}>
                <option value="medium">Medium</option>
                <option value="high">High</option>
            </Select>
        );

        fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
        expect(onChange).toHaveBeenCalled();
        expect(screen.getByLabelText("Priority")).toHaveValue("high");
    });

    it("renders an empty state action", () => {
        const onRetry = jest.fn();
        render(
            <EmptyState
                title="Nothing here"
                description="Try again in a moment."
                action={<button type="button" onClick={onRetry}>Retry</button>}
            />
        );

        expect(screen.getByText("Nothing here")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("renders status indicator text", () => {
        render(<StatusIndicator tone="success">Completed</StatusIndicator>);
        expect(screen.getByText("Completed")).toHaveAttribute("data-slot", "status-indicator");
    });

    it("renders a skeleton block", () => {
        render(<Skeleton data-testid="loading-block" />);
        expect(screen.getByTestId("loading-block")).toHaveAttribute("data-slot", "skeleton");
    });
});
