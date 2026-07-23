import mongoose, { Mongoose } from "mongoose";
import { User } from "@semantask/db/models/User";

const CONNECT_PROMISE_KEY = "__semantaskConnectPromise";

type MongooseWithConnectPromise = typeof mongoose & {
    [CONNECT_PROMISE_KEY]?: Promise<Mongoose>;
};


export async function connectToDatabase(): Promise<Mongoose> {
    const mongoUri = process.env.MONGODB_URI as string | undefined;

    if (!mongoUri) {
        throw new Error("Please define the MONGODB_URI environment variable in your .env file");
    }

    mongoose.set("bufferCommands", false);

    if (mongoose.connection.readyState === 1) {
        return mongoose;
    }

    const mongooseRef = mongoose as MongooseWithConnectPromise;

    if (!mongooseRef[CONNECT_PROMISE_KEY]) {
        mongooseRef[CONNECT_PROMISE_KEY] = mongoose
            .connect(mongoUri, {
                bufferCommands: false,
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
            })
            .catch((err) => {
                delete mongooseRef[CONNECT_PROMISE_KEY];
                throw err;
            });
    }

    await mongooseRef[CONNECT_PROMISE_KEY];
    return mongoose;
}

export interface UserFromDatabase {
    id: string;
    name: string;
    email: string;
    image?: string;
    role: string;
}

export async function getUserFromDB(email: string): Promise<UserFromDatabase | undefined> {
    try {
        await connectToDatabase();

        const user = await User.findOne({ email });

        if (!user) {
            throw new Error("User not found");
        }

        return {
            id: user._id.toString(),
            name: user.username,
            email: user.email,
            image: user.profilePicture,
            role: user.role,
        };
    } catch (error) {
        console.error("Error fetching user from DB:", error);
    }
}
