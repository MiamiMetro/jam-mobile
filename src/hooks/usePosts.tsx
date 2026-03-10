import { usePaginatedQuery } from "convex/react";
import { api } from "../..//convex/_generated/api";

export function usePosts() {
    const {
        results,
        status,
        loadMore,
    } = usePaginatedQuery(api.posts.getFeedPaginated, {}, { initialNumItems: 10 });

    return {
        posts: results,
        isLoading: status === "LoadingFirstPage",
        isLoadingMore: status === "LoadingMore",
        loadMore,
    };
}