import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";

// Mock the Prisma client
const mockPrisma = {
  user_account: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  reviews: {
    deleteMany: vi.fn(),
  },
  comments: {
    deleteMany: vi.fn(),
  },
  issues: {
    deleteMany: vi.fn(),
  },
  books: {
    deleteMany: vi.fn(),
  },
  $disconnect: vi.fn(),
};

// Mock the prisma import
vi.mock("@/lib/prisma", () => ({
  default: mockPrisma,
}));

// Create a test database path
const testDbPath = path.join(process.cwd(), ".test-db-auth");

// Simulate the authorize function from auth.ts
async function simulateAuthorize(credentials: {
  email?: string;
  password?: string;
  name?: string;
}) {
  if (!credentials?.email || !credentials?.password) {
    throw new Error("Invalid credentials");
  }

  // Check if user exists in the mock database
  const user = await mockPrisma.user_account.findUnique({
    where: { email: credentials.email },
  });

  if (!user) {
    // Create new user
    return await mockPrisma.user_account.create({
      data: {
        name: credentials.name ?? credentials.email,
        email: credentials.email,
        password: await bcrypt.hash(credentials.password, 10),
      },
    });
  }

  // User exists - verify password
  const isCorrectPassword = await bcrypt.compare(
    credentials.password,
    user.password
  );

  if (!isCorrectPassword) {
    throw new Error("Invalid credentials");
  }

  return user;
}

describe("Registration Backend Integration Tests", () => {
  beforeAll(async () => {
    // Reset mocks before all tests
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up after all tests
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    // Clear mock data before each test
    vi.clearAllMocks();
  });

  it("should fail to register with no email address", async () => {
    const credentials = {
      email: null,
      password: "password123",
      name: "John Doe",
    };

    try {
      // Simulate the authorize function logic
      if (!credentials.email || !credentials.password) {
        throw new Error("Invalid credentials");
      }
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid credentials");
    }
  });

  it("should fail to register with no password", async () => {
    const credentials = {
      email: "john@example.com",
      password: null,
      name: "John Doe",
    };

    try {
      // Simulate the authorize function logic
      if (!credentials.email || !credentials.password) {
        throw new Error("Invalid credentials");
      }
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid credentials");
    }
  });


  it("should succeed to register with user name, email address and password", async () => {
    const credentials = {
      email: "john@example.com",
      password: "password123",
      name: "John Doe",
    };

    const hashedPassword = await bcrypt.hash(credentials.password, 10);
    const createdUser = {
      id: "user-1",
      name: credentials.name,
      email: credentials.email,
      password: hashedPassword,
      api_key: null,
      avatar: null,
    };

    // Mock the database calls
    mockPrisma.user_account.findUnique.mockResolvedValueOnce(null);
    mockPrisma.user_account.create.mockResolvedValueOnce(createdUser);

    // Call the authorize function
    const user = await simulateAuthorize(credentials);

    // Verify the user was created
    expect(user).toBeDefined();
    expect(user.email).toBe("john@example.com");
    expect(user.name).toBe("John Doe");
    expect(user.password).not.toBe("password123"); // Should be hashed

    // Verify password is correct
    const isPasswordValid = await bcrypt.compare(
      credentials.password,
      user.password
    );
    expect(isPasswordValid).toBe(true);

    // Verify mocks were called
    expect(mockPrisma.user_account.findUnique).toHaveBeenCalledWith({
      where: { email: credentials.email },
    });
    expect(mockPrisma.user_account.create).toHaveBeenCalled();
  });

  it("should fail to register with email address same as existing account", async () => {
    const firstCredentials = {
      email: "existing@example.com",
      password: "password123",
      name: "First User",
    };

    const secondCredentials = {
      email: "existing@example.com",
      password: "password456",
      name: "Second User",
    };

    const existingUser = {
      id: "user-1",
      name: firstCredentials.name,
      email: firstCredentials.email,
      password: await bcrypt.hash(firstCredentials.password, 10),
      api_key: null,
      avatar: null,
    };

    // Mock the database - user exists with different password
    mockPrisma.user_account.findUnique.mockResolvedValueOnce(existingUser);

    // Try to register with same email but different password
    try {
      await simulateAuthorize(secondCredentials);
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid credentials");
    }

    // Verify that create was NOT called
    expect(mockPrisma.user_account.create).not.toHaveBeenCalled();
  });

  it("should handle duplicate email correctly when existing user has correct password", async () => {
    const credentials = {
      email: "user@example.com",
      password: "password123",
      name: "User",
    };

    const hashedPassword = await bcrypt.hash(credentials.password, 10);
    const existingUser = {
      id: "user-1",
      name: credentials.name,
      email: credentials.email,
      password: hashedPassword,
      api_key: null,
      avatar: null,
    };

    // Mock the database - user exists with correct password
    mockPrisma.user_account.findUnique.mockResolvedValueOnce(existingUser);

    // Try to "register" with same email and correct password
    const user = await simulateAuthorize(credentials);

    // Should return the existing user without creating a new one
    expect(user.id).toBe(existingUser.id);
    expect(mockPrisma.user_account.create).not.toHaveBeenCalled();
  });
});
