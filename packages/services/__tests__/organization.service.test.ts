import { canManageMembers } from "../organization.service";

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@semantask/db/models/Organization", () => ({
    __esModule: true,
    default: {},
}));

jest.mock("@semantask/db/models/OrganizationMembership", () => ({
    __esModule: true,
    default: {},
    ORGANIZATION_MEMBER_ROLES: ["owner", "admin", "member"],
}));

describe("organization.service helpers", () => {
    it("allows owners and admins to manage members", () => {
        expect(canManageMembers("owner")).toBe(true);
        expect(canManageMembers("admin")).toBe(true);
        expect(canManageMembers("member")).toBe(false);
    });
});
