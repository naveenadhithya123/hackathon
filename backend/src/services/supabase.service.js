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

  const { data, error } = await supabase
    .from("chats")
    .select("id, title, updated_at, messages(id, role, content, metadata, created_at)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((chat) => ({
    ...chat,
    messages: [...(chat.messages || [])].sort((left, right) => {
      const leftTime = left?.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right?.created_at ? new Date(right.created_at).getTime() : 0;
      return leftTime - rightTime;
    }),
  }));
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
