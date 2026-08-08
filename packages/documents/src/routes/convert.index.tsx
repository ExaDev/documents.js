import { Container, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, Link } from '@tanstack/react-router';

import { useConversions } from '../hooks/useConversions';

export const Route = createFileRoute('/convert/')({
  component: ConvertIndexPage,
});

function ConvertIndexPage() {
  const conversions = useConversions();

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Title order={2}>Convert a document</Title>
        <Text c="dimmed">Pick a source and target format. Every pair below is resolved live from the conversion engine, not hand-maintained.</Text>
        {conversions.isPending && <Loader />}
        {conversions.isError && <Text c="red">Could not load the conversion list: {conversions.error.message}</Text>}
        {conversions.data && (
          // Link is rendered directly rather than through Mantine's Anchor component={Link} pattern: composing it with Mantine's polymorphic `component` prop erases TanStack Router's per-route `params` type, so `to`/`params` stop being checked against the real route tree.
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
            {conversions.data.map((pair) => (
              <Link
                key={`${pair.source}-${pair.target}`}
                to="/convert/$source/$target"
                params={{ source: pair.source, target: pair.target }}
              >
                {pair.source} &rarr; {pair.target}
              </Link>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  );
}
