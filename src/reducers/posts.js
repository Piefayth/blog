import ActionTypes from '../constants/actionTypes'

const initialState = {}

export default function posts(state = initialState, action) {
  switch (action.type) {
    case ActionTypes.GET_POST_SUCCESS:
      return {
          ...state,
          post: action.post
      }
    case ActionTypes.GET_POST_ERROR: {
        return {
            ...state,
            post: null,
            error: action.error,
        }
    }
    case ActionTypes.GET_POSTS_SUCCESS:
        return {
            ...state,
            posts: action.posts
        }
    case ActionTypes.GET_POSTS_ERROR: {
        return {
            ...state,
            posts: null,
            error: action.error,
        }
    }
    default:
        return state
  }
}
