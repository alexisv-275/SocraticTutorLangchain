-- Uses the bucket and ingestion records already managed by n8n.
create or replace function public.thinkagora_material_indexado(p_object_path text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from rag.storage_ingestion i
    join storage.objects o on o.id = i.object_id and o.version::text = i.object_version
    where o.bucket_id = 'material-academico' and o.name = p_object_path
      and i.object_path = p_object_path and i.chunk_count > 0
  );
$$;

create or replace function public.thinkagora_buscar_material(p_embedding text, p_source text)
returns table (source text, heading text, chunk_position integer, content text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.source, c.heading, c.position, c.content
  from rag.chunks c
  where c.session_id = 'storage:material-academico' and c.source = p_source
  order by c.embedding operator(extensions.<->) p_embedding::extensions.vector(1024), c.id
  limit 5;
$$;

revoke all on function public.thinkagora_material_indexado(text) from public, anon, authenticated;
revoke all on function public.thinkagora_buscar_material(text, text) from public, anon, authenticated;
grant execute on function public.thinkagora_material_indexado(text) to service_role;
grant execute on function public.thinkagora_buscar_material(text, text) to service_role;
