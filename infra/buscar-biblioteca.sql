-- Apply to BD-ThinkAgora after the existing Storage ingestion schema.
create or replace function public.thinkagora_buscar_biblioteca(p_embedding text)
returns table (source text, heading text, chunk_position integer, content text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.source, c.heading, c.position, c.content
  from rag.chunks c
  where c.session_id = 'storage:material-academico'
  order by c.embedding operator(extensions.<->) p_embedding::extensions.vector(1024), c.id
  limit 5;
$$;

revoke all on function public.thinkagora_buscar_biblioteca(text) from public, anon, authenticated;
grant execute on function public.thinkagora_buscar_biblioteca(text) to service_role;
