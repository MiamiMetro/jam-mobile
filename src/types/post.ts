import {User} from "./user";

export type Post = {
    id : string;
    content : string;
    author : User;
}