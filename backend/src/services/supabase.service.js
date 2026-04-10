import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const isConfigured =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = isConfigured
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )
  : null;

function toPgVector(vector) {
  return `[${vector.join(",")}]`;
}

const CHAT_SELECT =
  "id, title, user_id, updated_at, created_at, messages(id, role, content, metadata, created_at), chat_shares(share_token)";

function sortMessages(messages = []) {
  return [...(messages || [])].sort((left, right) => {
    const leftTime = left?.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right?.created_at ? new Date(right.created_at).getTime() : 0;
    return leftTime - rightTime;
  });
}

function mapChatRecord(chat, extras = {}) {
  if (!chat) {
    return null;
  }

  const shareToken = Array.isArray(chat.chat_shares)
    ? chat.chat_shares[0]?.share_token || ""
    : chat.chat_shares?.share_token || "";

  return {
    ...chat,
    ...extras,
    shareToken: extras.shareToken || shareToken,
    messages: sortMessages(chat.messages || []),
  };
}

export async function upsertProfile(profile) {
  if (!supabase) {
    return profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createChat(chat) {
  if (!supabase) {
    return chat;
  }

  const { data, error } = await supabase
    .from("chats")
    .upsert(chat)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getOwnedChatById(chatId, userId) {
  if (!supabase || !chatId || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("chats")
    .select(CHAT_SELECT)
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return mapChatRecord(data);
}

export async function getChatByIdForUser(chatId, userId) {
  if (!supabase || !chatId || !userId) {
    return null;
  }

  const ownedChat = await getOwnedChatById(chatId, userId);

  if (ownedChat) {
    return {
      ...ownedChat,
      isOwned: true,
      isSharedAccess: false,
    };
  }

  const { data, error } = await supabase
    .from("chat_members")
    .select(`chat_id, chats(${CHAT_SELECT})`)
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return mapChatRecord(data?.chats, {
    isOwned: false,
    isSharedAccess: Boolean(data?.chats),
  });
}

export async function saveMessage(message) {
  if (!supabase) {
    return message;
  }

  const { data, error } = await supabase
    .from("messages")
    .insert(message)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await supabase
    .from("chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", message.chat_id);

  return data;
}

export async function listChatsByUser(userId) {
  if (!supabase) {
    return [];
  }

  const [{ data: ownedChats, error: ownedError }, { data: memberChats, error: memberError }] =
    await Promise.all([
      supabase
        .from("chats")
        .select(CHAT_SELECT)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("chat_members")
        .select(`chat_id, chats(${CHAT_SELECT})`)
        .eq("user_id", userId),
    ]);

  if (ownedError) {
    throw new Error(ownedError.message);
  }

  if (memberError) {
    throw new Error(memberError.message);
  }

  const merged = new Map();

  for (const chat of ownedChats || []) {
    merged.set(chat.id, mapChatRecord(chat, { isOwned: true, isSharedAccess: false }));
  }

  for (const membership of memberChats || []) {
    const chat = membership?.chats;
    if (!chat || merged.has(chat.id)) {
      continue;
    }

    merged.set(chat.id, mapChatRecord(chat, { isOwned: false, isSharedAccess: true }));
  }

  return [...merged.values()].sort((left, right) => {
    const leftTime = left?.updated_at ? new Date(left.updated_at).getTime() : 0;
    const rightTime = right?.updated_at ? new Date(right.updated_at).getTime() : 0;
    return rightTime - leftTime;
  });
}

export async function createOrGetChatShare(chatId, ownerUserId) {
  if (!supabase) {
    return {
      chat_id: chatId,
      owner_user_id: ownerUserId,
      share_token: crypto.randomBytes(18).toString("hex"),
    };
  }

  const ownedChat = await getOwnedChatById(chatId, ownerUserId);

  if (!ownedChat) {
    throw new Error("Only the chat owner can create a share link.");
  }

  const { data: existingShare, error: existingError } = await supabase
    .from("chat_shares")
    .select("chat_id, owner_user_id, share_token")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingShare) {
    return existingShare;
  }

  const { data, error } = await supabase
    .from("chat_shares")
    .insert({
      chat_id: chatId,
      owner_user_id: ownerUserId,
      share_token: crypto.randomBytes(18).toString("hex"),
    })
    .select("chat_id, owner_user_id, share_token")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function addChatMember(chatId, userId) {
  if (!supabase || !chatId || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("chat_members")
    .upsert({
      chat_id: chatId,
      user_id: userId,
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getSharedChatByToken(token, userId) {
  if (!supabase || !token || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("chat_shares")
    .select(`chat_id, owner_user_id, share_token, chats(${CHAT_SELECT})`)
    .eq("share_token", token)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.chats) {
    return null;
  }

  if (data.owner_user_id !== userId) {
    await addChatMember(data.chat_id, userId);
  }

  return mapChatRecord(data.chats, {
    shareToken: data.share_token,
    isOwned: data.owner_user_id === userId,
    isSharedAccess: data.owner_user_id !== userId,
  });
}

export async function saveDocument(document) {
  if (!supabase) {
    return {
      id: crypto.randomUUID(),
      ...document,
    };
  }

  const { data, error } = await supabase
    .from("documents")
    .insert(document)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function saveDocumentChunks(documentId, userId, chunks) {
  if (!supabase || chunks.length === 0) {
    return [];
  }

  const payload = chunks.map((chunk) => ({
    document_id: documentId,
    user_id: userId,
    chunk_index: chunk.chunk_index,
    content: chunk.content,
    embedding: toPgVector(chunk.embedding),
  }));

  const { data, error } = await supabase
    .from("document_chunks")
    .insert(payload)
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function searchDocumentChunks(
  userId,
  documentIds,
  queryEmbedding,
  matchCount = 6,
) {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: toPgVector(queryEmbedding),
    match_count: matchCount,
    filter_user_id: userId,
    filter_document_ids: documentIds.length ? documentIds : null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listDocumentChunks(userId, documentIds, limit = 80) {
  if (!supabase || !documentIds?.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, documents(title)")
    .eq("user_id", userId)
    .in("document_id", documentIds)
    .order("chunk_index", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((item) => ({
    id: item.id,
    document_id: item.document_id,
    document_title: item.documents?.title || "Document",
    content: item.content,
  }));
}

export async function getDocumentsByIds(userId, documentIds) {
  if (!supabase || !documentIds?.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id, title, extracted_text, summary")
    .eq("user_id", userId)
    .in("id", documentIds);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
